// src/routes/geracao.routes.js
// STEP 4 — Nano Banana Pro: geração completa em 1 chamada
const router    = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI    = require('openai');
const auth      = require('../middlewares/auth.middleware');
const prisma    = require('../prisma/client');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.use(auth);

// ── POST /api/gerar — Geração completa (textos + imagem) ──────
router.post('/', async (req, res, next) => {
  try {
    const {
      produtoId,        // (opcional) vincular a produto existente
      nome,
      categoria,
      preco,
      caracteristicas,
      publicoAlvo,
      tom = 'persuasivo',
      gerarImagem = true,
      estiloImagem = 'product photo, white background, studio lighting, high quality',
      tamanhoImagem = '1024x1024',
    } = req.body;

    if (!nome) return res.status(400).json({ erro: 'nome do produto é obrigatório.' });

    // Busca o modelo treinado do seller (se existir)
    const seller = await prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { openaiModelId: true },
    });

    // ── 1. Claude gera textos + prompt de imagem ─────────────
    const prompt = `Você é especialista em marketplace Shopee Brasil.
Produto: ${nome}
${categoria     ? `Categoria: ${categoria}`       : ''}
${preco         ? `Preço: R$ ${preco}`            : ''}
${caracteristicas ? `Características: ${caracteristicas}` : ''}
${publicoAlvo   ? `Público-alvo: ${publicoAlvo}` : ''}
Tom: ${tom}

Retorne SOMENTE um JSON válido sem markdown:
{
  "titulo_principal": "até 120 chars, palavras-chave para Shopee",
  "titulo_alternativo": "segunda opção até 120 chars",
  "descricao": "descrição rica com emojis, bullets ✅, benefícios e CTA, mínimo 150 palavras",
  "palavras_chave": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],
  "prompt_imagem": "prompt profissional em inglês para DALL-E 3 gerar foto de e-commerce deste produto"
}`;

    const respostaClaude = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textoResposta = respostaClaude.content[0].text.replace(/```json|```/g, '').trim();
    const gerado = JSON.parse(textoResposta);
    const tokensUsados = respostaClaude.usage.input_tokens + respostaClaude.usage.output_tokens;

    // ── 2. DALL-E 3 (ou modelo treinado) gera imagem ─────────
    let urlImagem = null;
    let modeloUsado = 'sem-imagem';

    if (gerarImagem) {
      const promptCompleto = `${gerado.prompt_imagem}, ${estiloImagem}, no text, no watermark`;

      // Usa o modelo treinado do seller se disponível
      const modeloImagem = seller?.openaiModelId || 'dall-e-3';

      const respostaImagem = await openai.images.generate({
        model:   modeloImagem,
        prompt:  promptCompleto,
        n:       1,
        size:    tamanhoImagem,
        quality: 'standard',
      });

      urlImagem   = respostaImagem.data[0].url;
      modeloUsado = modeloImagem;
    }

    // ── 3. Cria ou vincula produto no banco ───────────────────
    let produto;
    if (produtoId) {
      produto = await prisma.produto.findFirst({
        where: { id: produtoId, sellerId: req.sellerId },
      });
    }
    if (!produto) {
      produto = await prisma.produto.create({
        data: {
          sellerId: req.sellerId,
          nome, categoria, preco, caracteristicas, publicoAlvo, tom,
        },
      });
    }

    // ── 4. Salva geração no banco ─────────────────────────────
    const geracao = await prisma.geracao.create({
      data: {
        produtoId:         produto.id,
        sellerId:          req.sellerId,
        tituloPrincipal:   gerado.titulo_principal,
        tituloAlternativo: gerado.titulo_alternativo,
        descricao:         gerado.descricao,
        palavrasChave:     gerado.palavras_chave,
        urlImagem,
        promptImagem:      gerado.prompt_imagem,
        modeloImagem:      modeloUsado,
        tamanhoImagem,
        tokensUsados,
      },
    });

    res.status(201).json({
      mensagem: 'Conteúdo gerado com sucesso!',
      geracao,
      produto,
    });
  } catch (err) { next(err); }
});

// GET /api/gerar — histórico de gerações do seller
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [geracoes, total] = await Promise.all([
      prisma.geracao.findMany({
        where: { sellerId: req.sellerId },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: Number(limit),
        include: { produto: { select: { nome: true, categoria: true } } },
      }),
      prisma.geracao.count({ where: { sellerId: req.sellerId } }),
    ]);

    res.json({ geracoes, total, page: Number(page), totalPaginas: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// GET /api/gerar/:id — detalhe de uma geração
router.get('/:id', async (req, res, next) => {
  try {
    const geracao = await prisma.geracao.findFirst({
      where: { id: req.params.id, sellerId: req.sellerId },
      include: { produto: true },
    });
    if (!geracao) return res.status(404).json({ erro: 'Geração não encontrada.' });
    res.json(geracao);
  } catch (err) { next(err); }
});

module.exports = router;
