# Polemicyst

A Next.js-based viral clip generation platform for content creators. Automatically identifies and extracts engaging moments from long-form video content.

## 🚀 Features

- **Automated Clip Detection**: AI-powered identification of viral moments in video content
- **Multi-Environment Support**: Separate production and development environments
- **RSS Feed Integration**: Automatic video ingestion from YouTube RSS feeds
- **LLM-Based Scoring**: Gemini/Ollama integration for content analysis
- **Cloud Infrastructure**: AWS ECS Fargate deployment with auto-scaling
- **OAuth Authentication**: Google OAuth with allowlist support

## 🏗️ Architecture

### Multi-Environment Setup

The application supports two environments sharing cost-effective infrastructure:

- **Production**: `main` branch → [polemicyst.com](https://polemicyst.com)
- **Development**: `develop` branch → [dev.polemicyst.com](https://dev.polemicyst.com)

**Shared Resources** (~$109/month):

- VPC with NAT Gateways
- RDS PostgreSQL instance (separate databases per environment)
- S3 bucket (environment-specific prefixes: `prod/`, `dev/`)
- Application Load Balancer with host-based routing
- ECS Cluster

**Environment-Specific** (~$16/month for dev):

- ECS Services and Task Definitions
- ALB Target Groups
- Redis instances
- DNS records

**Total Cost**: ~$178/month

### Tech Stack

**Frontend**:

- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- NextAuth.js for authentication

**Backend**:

- Node.js
- Prisma ORM
- PostgreSQL (AWS RDS)
- Redis (BullMQ for job queues)
- AWS S3 for video storage

**Workers**:

- Clip Worker: Video processing and clip extraction (FFmpeg)
- LLM Workers: Content scoring (Gemini API, Ollama)
- Transcription Worker: Video-to-text conversion
- Feed Poller: RSS feed monitoring

**Infrastructure**:

- AWS ECS Fargate
- Terraform for infrastructure as code
- GitHub Actions for CI/CD
- Route53 for DNS
- ACM for SSL certificates

## 🛠️ Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis
- FFmpeg
- AWS credentials (for S3 access)

### Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/austinconnor1836/polemicyst.com.git
   cd polemicyst.com
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Set up environment variables**:

   ```bash
   cp ENV_VARS.template .env.local
   # Edit .env.local with your configuration
   ```

4. **Set up database**:

   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

5. **Start Redis** (required for workers):

   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine

   # Or using docker-compose
   docker-compose up -d redis
   ```

6. **Run the development server**:

   ```bash
   npm run dev
   ```

7. **Open your browser**:
   - Visit [http://localhost:3000](http://localhost:3000)

### Running Workers Locally

```bash
# Clip worker
cd workers/clip-worker
npm install
npm run dev

# LLM worker
cd workers/llm-worker
npm install
npm run dev

# Feed poller
cd workers/poller-worker
npm install
npm run dev
```

## 📦 Deployment

The application uses automated GitHub Actions deployment:

### Deploy to Development

```bash
git checkout develop
git add .
git commit -m "Your changes"
git push origin develop
```

Automatically deploys to [dev.polemicyst.com](https://dev.polemicyst.com)

### Deploy to Production

```bash
git checkout main
git merge develop
git push origin main
```

Automatically deploys to [polemicyst.com](https://polemicyst.com)

### Manual Deployment

For manual infrastructure updates:

```bash
cd infrastructure
terraform init
terraform plan
terraform apply
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions.

## 📚 Documentation

- **[DEPLOYMENT.md](docs/DEPLOYMENT.md)**: Complete deployment guide including infrastructure setup
- **[DEPLOYMENT_STATUS.md](docs/DEPLOYMENT_STATUS.md)**: Current deployment status and pending tasks
- **[CLAUDE.md](CLAUDE.md)**: LLM system architecture and scoring implementation

## 🔧 Configuration

### Environment Variables

Key environment variables (see `ENV_VARS.template` for complete list):

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# S3 Storage
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
S3_PREFIX=prod  # or 'dev'

# Authentication
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your-secret-here
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# Redis
REDIS_HOST=localhost  # or redis-prod.polemicyst.local in AWS

# Environment
ENVIRONMENT=prod  # or 'dev'
NODE_ENV=production  # or 'development'
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run linter
npm run lint

# Run type checking
npm run type-check
```

## 📊 Monitoring

### Check Service Status

```bash
# ECS services
aws ecs describe-services --cluster polemicyst-cluster --services polemicyst-prod-web polemicyst-dev-web

# CloudWatch logs
aws logs tail /ecs/polemicyst-prod-web --follow
aws logs tail /ecs/polemicyst-dev-web --follow
```

### Cost Monitoring

Monitor AWS costs in Cost Explorer, filtered by:

- Environment tags (prod/dev)
- Service types (ECS, RDS, S3, etc.)

## 🤝 Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Test locally
4. Push to `develop` branch
5. Verify deployment on dev.polemicyst.com
6. Merge to `main` for production deployment

## 📝 License

This project is proprietary software.

## 🐛 Issues and Support

For issues and feature requests, please use the GitHub issue tracker or contact the development team.

## 🔗 Links

- **Production**: [https://polemicyst.com](https://polemicyst.com)
- **Development**: [https://dev.polemicyst.com](https://dev.polemicyst.com)
- **GitHub**: [https://github.com/austinconnor1836/polemicyst.com](https://github.com/austinconnor1836/polemicyst.com)
- **GitHub Actions**: [View Deployments](https://github.com/austinconnor1836/polemicyst.com/actions)
