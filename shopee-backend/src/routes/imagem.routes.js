// src/routes/imagem.routes.js
const router     = require('express').Router();
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const Anthropic  = require('@anthropic-ai/sdk');
const auth       = require('../middlewares/auth.middleware');
const prisma     = require('../prisma/client');

// Configuração Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer — armazena na memória para enviar ao Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Use JPG, PNG ou WEBP.'));
    }
  },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.use(auth);

// ── STEP 1 — POST /api/imagem/upload ─────────────────────────
// Recebe a imagem, salva no Cloudinary e retorna a URL
router.post('/upload', upload.single('imagem'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });

    // Upload para Cloudinary
    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `shopee-seller/${req.sellerId}`, resource_type: 'image' },
        (err, result) => err ? reject(err) : resolve(result)
      );
      stream.end(req.file.buffer);
    });

    // Salva no banco com status 'pendente'
    const imagem = await prisma.imagemTreino.create({
      data: {
        sellerId:     req.sellerId,
        urlOriginal:  resultado.secure_url,
        urlCloudinary: resultado.secure_url,
        publicId:     resultado.public_id,
        tamanhoBytes: req.file.size,
        formato:      req.file.mimetype.split('/')[1],
        status:       'pendente',
      },
    });

    res.status(201).json({
      mensagem: 'Imagem enviada com sucesso.',
      imagemId: imagem.id,
      url:      imagem.urlCloudinary,
    });
  } catch (err) { next(err); }
});

// ── STEP 2 — POST /api/imagem/analisar/:id ────────────────────
// Claude Vision analisa a imagem e extrai dados do produto
router.post('/analisar/:id', async (req, res, next) => {
  try {
    const imagem = await prisma.imagemTreino.findFirst({
      where: { id: req.params.id, sellerId: req.sellerId },
    });
    if (!imagem) return res.status(404).json({ erro: 'Imagem não encontrada.' });

    // Atualiza status
    await prisma.imagemTreino.update({
      where: { id: imagem.id },
      data: { status: 'analisando' },
    });

    // Chama Claude Vision
    const resposta = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imagem.urlCloudinary },
          },
          {
            type: 'text',
            text: `Você é especialista em e-commerce brasileiro. Analise esta imagem de produto e retorne SOMENTE um JSON válido sem markdown:
{
  "nome_sugerido": "nome comercial do produto em português",
  "categoria": "categoria principal (ex: Moda Masculina, Eletrônicos, etc)",
  "cor": "cor(es) principal(is)",
  "material": "material aparente ou tipo do produto",
  "descricao_curta": "descrição em 1 frase do que é o produto",
  "palavras_chave": ["kw1","kw2","kw3","kw4","kw5"]
}`,
          },
        ],
      }],
    });

    const textoResposta = resposta.content[0].text.replace(/```json|```/g, '').trim();
    const dados = JSON.parse(textoResposta);

    // Salva análise no banco
    const imagemAtualizada = await prisma.imagemTreino.update({
      where: { id: imagem.id },
      data: {
        descricaoIa: dados.descricao_curta,
        categoriaIa: dados.categoria,
        corIa:       dados.cor,
        materialIa:  dados.material,
        status:      'analisada',
      },
    });

    res.json({
      mensagem: 'Análise concluída.',
      imagem: imagemAtualizada,
      sugestoes: dados,
    });
  } catch (err) {
    await prisma.imagemTreino.updateMany({
      where: { id: req.params.id },
      data: { status: 'erro' },
    });
    next(err);
  }
});

// GET /api/imagem — lista imagens de treino do seller
router.get('/', async (req, res, next) => {
  try {
    const imagens = await prisma.imagemTreino.findMany({
      where: { sellerId: req.sellerId },
      orderBy: { criadoEm: 'desc' },
    });
    res.json(imagens);
  } catch (err) { next(err); }
});

// DELETE /api/imagem/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const imagem = await prisma.imagemTreino.findFirst({
      where: { id: req.params.id, sellerId: req.sellerId },
    });
    if (!imagem) return res.status(404).json({ erro: 'Imagem não encontrada.' });

    if (imagem.publicId) {
      await cloudinary.uploader.destroy(imagem.publicId);
    }
    await prisma.imagemTreino.delete({ where: { id: imagem.id } });
    res.json({ mensagem: 'Imagem removida.' });
  } catch (err) { next(err); }
});

module.exports = router;
