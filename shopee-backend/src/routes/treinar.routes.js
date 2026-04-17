// src/routes/treinar.routes.js
// STEP 3 — Fine-tuning OpenAI com imagens do catálogo do seller
const router = require('express').Router();
const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');
const auth   = require('../middlewares/auth.middleware');
const prisma = require('../prisma/client');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.use(auth);

// ── POST /api/treinar/iniciar — inicia o fine-tuning ─────────
router.post('/iniciar', async (req, res, next) => {
  try {
    // Busca imagens analisadas do seller
    const imagens = await prisma.imagemTreino.findMany({
      where: { sellerId: req.sellerId, status: 'analisada' },
    });

    if (imagens.length < 5) {
      return res.status(400).json({
        erro: 'Mínimo de 5 imagens analisadas necessárias para o treino.',
        imagensDisponiveis: imagens.length,
      });
    }

    // Monta o dataset JSONL (formato exigido pela OpenAI)
    const linhasJsonl = imagens.map(img => JSON.stringify({
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em produtos para Shopee Brasil.',
        },
        {
          role: 'user',
          content: `Gere um prompt para criar imagem profissional de produto para e-commerce: ${img.descricaoIa || img.categoriaIa || 'produto'}`,
        },
        {
          role: 'assistant',
          content: `Professional product photo of ${img.descricaoIa || 'item'}, ${img.corIa || ''}, ${img.materialIa || ''}, white background, studio lighting, high quality, e-commerce style`,
        },
      ],
    })).join('\n');

    // Salva o arquivo JSONL temporariamente
    const caminhoArquivo = path.join('/tmp', `treino_${req.sellerId}_${Date.now()}.jsonl`);
    fs.writeFileSync(caminhoArquivo, linhasJsonl);

    // Envia o arquivo para a OpenAI
    const arquivo = await openai.files.create({
      file:    fs.createReadStream(caminhoArquivo),
      purpose: 'fine-tune',
    });

    fs.unlinkSync(caminhoArquivo); // remove o arquivo temporário

    // Cria o job de fine-tuning na OpenAI
    const job = await openai.fineTuning.jobs.create({
      training_file: arquivo.id,
      model:         'gpt-4o-mini',
    });

    // Registra no banco
    const fineTuningJob = await prisma.fineTuningJob.create({
      data: {
        sellerId:     req.sellerId,
        openaiJobId:  job.id,
        openaiFileId: arquivo.id,
        status:       'treinando',
        totalImagens: imagens.length,
        modeloBase:   'gpt-4o-mini',
      },
    });

    // Marca imagens como "no_treino"
    await prisma.imagemTreino.updateMany({
      where: { sellerId: req.sellerId, status: 'analisada' },
      data:  { status: 'no_treino' },
    });

    res.status(201).json({
      mensagem: 'Treino iniciado! Você será notificado quando concluir.',
      job: fineTuningJob,
      openaiJobId: job.id,
    });
  } catch (err) { next(err); }
});

// ── POST /api/treinar/webhook — OpenAI notifica quando conclui ─
// Configure esta URL no painel OpenAI como webhook endpoint
router.post('/webhook', async (req, res, next) => {
  try {
    const { data } = req.body;
    if (!data || !data.id) return res.status(400).json({ erro: 'Payload inválido.' });

    const jobOpenAI = data;

    // Encontra o job no banco pelo openai_job_id
    const job = await prisma.fineTuningJob.findUnique({
      where: { openaiJobId: jobOpenAI.id },
    });
    if (!job) return res.status(404).json({ erro: 'Job não encontrado.' });

    if (jobOpenAI.status === 'succeeded') {
      const modeloResultante = jobOpenAI.fine_tuned_model;

      // Atualiza o job
      await prisma.fineTuningJob.update({
        where: { id: job.id },
        data: {
          status:           'concluido',
          modeloResultante,
          concluidoEm:      new Date(),
        },
      });

      // Salva o modelo no seller para usar nas gerações futuras
      await prisma.seller.update({
        where: { id: job.sellerId },
        data: { openaiModelId: modeloResultante },
      });

    } else if (jobOpenAI.status === 'failed') {
      await prisma.fineTuningJob.update({
        where: { id: job.id },
        data: {
          status:         'falhou',
          erroMensagem:   jobOpenAI.error?.message || 'Erro desconhecido',
          concluidoEm:    new Date(),
        },
      });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/treinar/status — verifica status do job mais recente
router.get('/status', async (req, res, next) => {
  try {
    const job = await prisma.fineTuningJob.findFirst({
      where: { sellerId: req.sellerId },
      orderBy: { iniciadoEm: 'desc' },
    });

    if (!job) return res.json({ temJob: false });

    // Consulta status atualizado na OpenAI se ainda estiver treinando
    if (job.openaiJobId && job.status === 'treinando') {
      const jobOpenAI = await openai.fineTuning.jobs.retrieve(job.openaiJobId);
      if (jobOpenAI.status !== job.status) {
        await prisma.fineTuningJob.update({
          where: { id: job.id },
          data: { status: jobOpenAI.status },
        });
        job.status = jobOpenAI.status;
      }
    }

    res.json({ temJob: true, job });
  } catch (err) { next(err); }
});

// GET /api/treinar — histórico de todos os jobs do seller
router.get('/', async (req, res, next) => {
  try {
    const jobs = await prisma.fineTuningJob.findMany({
      where: { sellerId: req.sellerId },
      orderBy: { iniciadoEm: 'desc' },
    });
    res.json(jobs);
  } catch (err) { next(err); }
});

module.exports = router;
