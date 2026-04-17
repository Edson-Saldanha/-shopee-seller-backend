// src/routes/geracao.routes.js
const router = require('express').Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const auth = require('../middlewares/auth.middleware');
const prisma = require('../prisma/client');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.use(auth);

// ── POST /api/gerar ───────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const {
      produtoId,
      nome,
      categoria,
      preco,
      caracteristicas,
      publicoAlvo,
      tom = 'persuasivo',
      gerarImagens = true,
      quantidadeImagens = 5,
      tamanhoImagem = '1024x1024',
    } = req.body;

    if (!nome) return res.status(400).json({ erro: 'nome do produto é obrigatório.' });

    const seller = await prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { openaiModelId: true },
    });

    // ── 1. IA gera todos os textos + 5 prompts de imagem ─────
    let gerado;

    // Tenta Gemini primeiro, fallback para Claude
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'placeholder') {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const resultado = await model.generateContent(buildPrompt(nome, categoria, preco, caracteristicas, publicoAlvo, tom));
      gerado = JSON.parse(resultado.response.text().replace(/```json|```/g, '').trim());
    } else {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1500,
        messages: [{ role: 'user', content: buildPrompt(nome, categoria, preco, caracteristicas, publicoAlvo, tom) }],
      });
      gerado = JSON.parse(resp.content[0].text.replace(/```json|```/g, '').trim());
    }

    // ── 2. Gera as 5 imagens em paralelo com DALL-E 3 ────────
    let urlsImagens = [];
    let modeloUsado = 'sem-imagem';

    if (gerarImagens && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'placeholder') {
      const modeloImagem = seller?.openaiModelId || 'dall-e-3';
      const qtd = Math.min(Number(quantidadeImagens), 5);

      const estilos = [
        'white background, studio lighting, professional product photo',
        'lifestyle environment, natural lighting, editorial product photo',
        'flat lay, minimal, top view, clean background',
        'dramatic lighting, dark background, luxury product photo',
        'colorful background, promotional banner style, vibrant',
      ];

      const promisesImagens = Array.from({ length: qtd }, (_, i) =>
        openai.images.generate({
          model: modeloImagem,
          prompt: `${gerado.prompt_imagem_base}, ${estilos[i]}, no text, no watermark`,
          n: 1,
          size: tamanhoImagem,
          quality: 'standard',
        }).then(r => r.data[0].url).catch(() => null)
      );

      urlsImagens = (await Promise.all(promisesImagens)).filter(Boolean);
      modeloUsado = modeloImagem;
    }

    // ── 3. Cria ou vincula produto ────────────────────────────
    let produto;
    if (produtoId) produto = await prisma.produto.findFirst({ where: { id: produtoId, sellerId: req.sellerId } });
    if (!produto) produto = await prisma.produto.create({ data: { sellerId: req.sellerId, nome, categoria, preco, caracteristicas, publicoAlvo, tom } });

    // ── 4. Salva geração ──────────────────────────────────────
    const geracao = await prisma.geracao.create({
      data: {
        produtoId: produto.id,
        sellerId: req.sellerId,
        tituloPrincipal: gerado.titulo_principal,
        tituloAlternativo: gerado.titulo_alternativo,
        descricao: gerado.descricao,
        palavrasChave: gerado.palavras_chave,
        urlImagem: urlsImagens[0] || null,
        promptImagem: gerado.prompt_imagem_base,
        modeloImagem: modeloUsado,
        tamanhoImagem,
        tokensUsados: 0,
      },
    });

    res.status(201).json({
      mensagem: 'Conteúdo gerado com sucesso!',
      geracao,
      produto,
      imagens: urlsImagens,
      textos: {
        tituloPrincipal: gerado.titulo_principal,
        tituloAlternativo: gerado.titulo_alternativo,
        tituloExtra1: gerado.titulo_extra_1,
        tituloExtra2: gerado.titulo_extra_2,
        tituloExtra3: gerado.titulo_extra_3,
        descricao: gerado.descricao,
        palavrasChave: gerado.palavras_chave,
      },
    });
  } catch (err) { next(err); }
});

function buildPrompt(nome, categoria, preco, caracteristicas, publicoAlvo, tom) {
  return `Você é especialista em marketplace Shopee Brasil com foco em conversão.
Produto: ${nome}
${categoria ? `Categoria: ${categoria}` : ''}
${preco ? `Preço: R$ ${preco}` : ''}
${caracteristicas ? `Características: ${caracteristicas}` : ''}
${publicoAlvo ? `Público-alvo: ${publicoAlvo}` : ''}
Tom: ${tom}

Retorne SOMENTE um JSON válido sem markdown:
{
  "titulo_principal": "título principal até 120 chars com palavras-chave Shopee",
  "titulo_alternativo": "segunda variação até 120 chars com abordagem diferente",
  "titulo_extra_1": "terceira variação focada em benefício principal",
  "titulo_extra_2": "quarta variação focada em preço/custo-benefício",
  "titulo_extra_3": "quinta variação focada no público-alvo",
  "descricao": "descrição completa e rica com emojis no início das seções, bullets com ✅ para benefícios, especificações técnicas, CTA no final, mínimo 200 palavras",
  "palavras_chave": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8","kw9","kw10"],
  "prompt_imagem_base": "prompt base em inglês detalhado para DALL-E 3 gerar foto profissional deste produto"
}`;
}

// GET /api/gerar — histórico
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [geracoes, total] = await Promise.all([
      prisma.geracao.findMany({
        where: { sellerId: req.sellerId },
        orderBy: { criadoEm: 'desc' },
        skip, take: Number(limit),
        include: { produto: { select: { nome: true, categoria: true } } },
      }),
      prisma.geracao.count({ where: { sellerId: req.sellerId } }),
    ]);
    res.json({ geracoes, total, page: Number(page), totalPaginas: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// GET /api/gerar/:id
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