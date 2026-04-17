// src/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes    = require('./routes/auth.routes');
const produtoRoutes = require('./routes/produto.routes');
const imagemRoutes  = require('./routes/imagem.routes');
const geracaoRoutes = require('./routes/geracao.routes');
const treinarRoutes = require('./routes/treinar.routes');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middlewares globais ──────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ── Rota de health check ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Rotas da API ─────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/produto', produtoRoutes);
app.use('/api/imagem',  imagemRoutes);
app.use('/api/gerar',   geracaoRoutes);
app.use('/api/treinar', treinarRoutes);

// ── Handler de erros global ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message);
  res.status(err.status || 500).json({
    erro: err.message || 'Erro interno do servidor',
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
