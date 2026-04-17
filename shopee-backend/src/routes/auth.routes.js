// src/routes/auth.routes.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const prisma = require('../prisma/client');

// POST /api/auth/registro
router.post('/registro', async (req, res, next) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'nome, email e senha são obrigatórios.' });
    }

    const jaExiste = await prisma.seller.findUnique({ where: { email } });
    if (jaExiste) {
      return res.status(409).json({ erro: 'E-mail já cadastrado.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const seller = await prisma.seller.create({
      data: { nome, email, senhaHash },
      select: { id: true, nome: true, email: true, plano: true },
    });

    const token = jwt.sign(
      { sellerId: seller.id, plano: seller.plano },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ seller, token });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ erro: 'email e senha são obrigatórios.' });
    }

    const seller = await prisma.seller.findUnique({ where: { email } });
    if (!seller) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const senhaCorreta = await bcrypt.compare(senha, seller.senhaHash);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { sellerId: seller.id, plano: seller.plano },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      seller: { id: seller.id, nome: seller.nome, email: seller.email, plano: seller.plano },
      token,
    });
  } catch (err) { next(err); }
});

// GET /api/auth/me  — retorna o seller logado
router.get('/me', require('../middlewares/auth.middleware'), async (req, res, next) => {
  try {
    const seller = await prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { id: true, nome: true, email: true, plano: true, openaiModelId: true, criadoEm: true },
    });
    res.json(seller);
  } catch (err) { next(err); }
});

module.exports = router;
