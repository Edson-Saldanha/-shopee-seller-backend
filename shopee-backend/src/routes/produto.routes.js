// src/routes/produto.routes.js
const router  = require('express').Router();
const auth    = require('../middlewares/auth.middleware');
const prisma  = require('../prisma/client');

// Todas as rotas exigem autenticação
router.use(auth);

// POST /api/produto — cria produto
router.post('/', async (req, res, next) => {
  try {
    const { nome, categoria, preco, caracteristicas, publicoAlvo, tom } = req.body;
    if (!nome) return res.status(400).json({ erro: 'nome é obrigatório.' });

    const produto = await prisma.produto.create({
      data: {
        sellerId: req.sellerId,
        nome, categoria, preco, caracteristicas,
        publicoAlvo, tom: tom || 'persuasivo',
      },
    });
    res.status(201).json(produto);
  } catch (err) { next(err); }
});

// GET /api/produto — lista produtos do seller
router.get('/', async (req, res, next) => {
  try {
    const produtos = await prisma.produto.findMany({
      where: { sellerId: req.sellerId },
      orderBy: { criadoEm: 'desc' },
      include: { _count: { select: { geracoes: true } } },
    });
    res.json(produtos);
  } catch (err) { next(err); }
});

// GET /api/produto/:id — detalhe de um produto
router.get('/:id', async (req, res, next) => {
  try {
    const produto = await prisma.produto.findFirst({
      where: { id: req.params.id, sellerId: req.sellerId },
      include: { geracoes: { orderBy: { criadoEm: 'desc' }, take: 5 } },
    });
    if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(produto);
  } catch (err) { next(err); }
});

// PUT /api/produto/:id — atualiza produto
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.produto.findFirst({
      where: { id: req.params.id, sellerId: req.sellerId },
    });
    if (!existe) return res.status(404).json({ erro: 'Produto não encontrado.' });

    const atualizado = await prisma.produto.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(atualizado);
  } catch (err) { next(err); }
});

// DELETE /api/produto/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.produto.deleteMany({
      where: { id: req.params.id, sellerId: req.sellerId },
    });
    res.json({ mensagem: 'Produto removido.' });
  } catch (err) { next(err); }
});

module.exports = router;
