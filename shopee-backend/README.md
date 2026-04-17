# Shopee Seller AI — Backend

API Node.js + Express + Prisma + PostgreSQL (Railway)

## Estrutura de arquivos

```
shopee-backend/
├── prisma/
│   └── schema.prisma          # Mapeamento das tabelas
├── src/
│   ├── server.js              # Ponto de entrada
│   ├── prisma/
│   │   └── client.js          # Singleton do Prisma
│   ├── middlewares/
│   │   └── auth.middleware.js # Validação JWT
│   └── routes/
│       ├── auth.routes.js     # /api/auth (login, registro)
│       ├── produto.routes.js  # /api/produto (CRUD)
│       ├── imagem.routes.js   # /api/imagem (upload + análise)
│       ├── geracao.routes.js  # /api/gerar (Nano Banana Pro)
│       └── treinar.routes.js  # /api/treinar (fine-tuning)
├── .env.example
└── package.json
```

## Instalação local

```bash
# 1. Instalar dependências
npm install

# 2. Copiar e preencher variáveis de ambiente
cp .env.example .env

# 3. Gerar o cliente Prisma
npx prisma generate

# 4. Rodar o servidor
npm run dev
```

## Deploy no Railway

1. Crie um novo serviço no Railway (GitHub ou upload direto)
2. Adicione as variáveis de ambiente do `.env.example` no painel Railway
3. Na variável `DATABASE_URL`, use a mesma do seu PostgreSQL Railway
4. O Railway detecta automaticamente o `npm start`

## Rotas da API

### Autenticação
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/registro | Cadastrar novo seller |
| POST | /api/auth/login | Login e retorno do JWT |
| GET  | /api/auth/me | Dados do seller logado |

### Produtos
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/produto | Criar produto |
| GET  | /api/produto | Listar produtos |
| GET  | /api/produto/:id | Detalhe do produto |
| PUT  | /api/produto/:id | Atualizar produto |
| DELETE | /api/produto/:id | Remover produto |

### Imagens (Steps 1 e 2)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/imagem/upload | Step 1: upload da foto |
| POST | /api/imagem/analisar/:id | Step 2: Claude Vision analisa |
| GET  | /api/imagem | Listar imagens de treino |
| DELETE | /api/imagem/:id | Remover imagem |

### Geração (Step 4 — Nano Banana Pro)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/gerar | Gera título + descrição + imagem |
| GET  | /api/gerar | Histórico de gerações |
| GET  | /api/gerar/:id | Detalhe de uma geração |

### Treino (Step 3)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/treinar/iniciar | Inicia fine-tuning na OpenAI |
| GET  | /api/treinar/status | Status do treino atual |
| POST | /api/treinar/webhook | Webhook OpenAI (notificação de conclusão) |
| GET  | /api/treinar | Histórico de jobs de treino |

## Exemplo de uso — Geração completa

```bash
# 1. Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seller@teste.com","senha":"123456"}'

# 2. Gerar conteúdo completo (copie o token do passo anterior)
curl -X POST http://localhost:3001/api/gerar \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Tênis Nike Air Max masculino",
    "categoria": "Moda Masculina",
    "preco": "299,90",
    "caracteristicas": "Solado em foam, respirável, tamanhos 38-44",
    "tom": "persuasivo",
    "gerarImagem": true
  }'
```
