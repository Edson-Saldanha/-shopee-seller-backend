const router = require('express').Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const auth = require('../middlewares/auth.middleware');
const prisma = require('../prisma/client');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.use(auth);

router.post('/', async (req, res, next) => {
  try {
    const { produtoId, nome, categoria, preco, caracteristicas, publicoAlvo, tom = 'persuasivo', gerarImagem = true, estiloImagem = 'product photo, white background, studio lighting, high quality', tamanhoImagem = '1024x1024' } = req.body;
    if (!nome) return res.status(400).json({ erro: 'nome do produto é obrigatório.' });

    const seller = await prisma.seller.findUnique({ where: { id: req.sellerId }, select: { openaiModelId: true } });

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `Você é especialista em marketplace Shopee Brasil.
Produto: ${nome}
${categoria ? `Categoria: ${categoria}` : ''}
${preco ? `Preço: R$ ${preco}` : ''}
${caracteristicas ? `Características: ${caracteristicas}` : ''}
${publicoAlvo ? `Público-alvo: ${publicoAlvo}` : ''}
Tom: ${tom}

Retorne SOMENTE um JSON válido sem markdown, sem blocos de código:
{"titulo_principal":"até 120 chars","titulo_alternativo":"segunda opção até 120 chars","descricao":"descrição rica com emojis, bullets ✅, benefícios e CTA, mínimo 150 palavras","palavras_chave":["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],"prompt_imagem":"prompt em inglês para DALL-E 3"}`;

    const resultado = await model.generateContent(prompt);
    const gerado = JSON.parse(resultado.response.text().replace(/```json|```/g, '').trim());

    let urlImagem = null, modeloUsado = 'sem-imagem';
    if (gerarImagem && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'placeholder') {
      const respostaImagem = await openai.images.generate({ model: seller?.openaiModelId || 'dall-e-3', prompt: `${gerado.prompt_imagem}, ${estiloImagem}, no text, no watermark`, n: 1, size: tamanhoImagem, quality: 'standard' });
      urlImagem = respostaImagem.data[0].url;
      modeloUsado = seller?.openaiModelId || 'dall-e-3';
    }

    let produto;
    if (produtoId) produto = await prisma.produto.findFirst({ where: { id: produtoId, sellerId: req.sellerId } });
    if (!produto) produto = await prisma.produto.create({ data: { sellerId: req.sellerId, nome, categoria, preco, caracteristicas, publicoAlvo, tom } });

    const geracao = await prisma.geracao.create({ data: { produtoId: produto.id, sellerId: req.sellerId, tituloPrincipal: gerado.titulo_principal, tituloAlternativo: gerado.titulo_alternativo, descricao: gerado.descricao, palavrasChave: gerado.palavras_chave, urlImagem, promptImagem: gerado.prompt_imagem, modeloImagem: modeloUsado, tamanhoImagem, tokensUsados: 0 } });

    res.status(201).json({ mensagem: 'Conteúdo gerado com sucesso!', geracao, produto });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [geracoes, total] = await Promise.all([
      prisma.geracao.findMany({ where: { sellerId: req.sellerId }, orderBy: { criadoEm: 'desc' }, skip, take: Number(limit), include: { produto: { select: { nome: true, categoria: true } } } }),
      prisma.geracao.count({ where: { sellerId: req.sellerId } }),
    ]);
    res.json({ geracoes, total, page: Number(page), totalPaginas: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const geracao = await prisma.geracao.findFirst({ where: { id: req.params.id, sellerId: req.sellerId }, include: { produto: true } });
    if (!geracao) return res.status(404).json({ erro: 'Geração não encontrada.' });
    res.json(geracao);
  } catch (err) { next(err); }
});

module.exports = router;