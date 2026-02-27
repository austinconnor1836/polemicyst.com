# Polemicyst Business Reading List

A curated set of books and resources for building and scaling a SaaS content-creator platform with AI-powered video clipping and multi-platform social distribution.

---

## 1. SaaS Business Fundamentals

- **"Obviously Awesome" by April Dunford** — Positioning your product in a crowded market of video tools (Opus Clip, Repurpose.io, Vizard, etc.). Helps you articulate *why* Polemicyst exists vs. the alternatives.
- **"The Mom Test" by Rob Fitzpatrick** — How to talk to content creators and actually learn what they need, without leading them. Essential for validating features before building them.
- **"Deploy Empathy" by Michele Hansen** — Deeper customer interview techniques. Pairs well with The Mom Test for ongoing user research.
- **"Running Lean" by Ash Maurya** — Lean Canvas framework for systematically de-risking your business model (pricing tiers, channel strategy, cost structure).

## 2. Pricing & Monetization

- **"Monetizing Innovation" by Madhavan Ramanujam & Georg Tacke** — How to design pricing around willingness-to-pay rather than cost-plus. Critical for getting your free/pro tier split right.
- **"The Strategy and Tactics of Pricing" by Thomas Nagle** — The academic-but-practical bible of pricing. Useful reference as you add tiers or usage-based billing.
- **Stripe's pricing guides** (https://stripe.com/guides/atlas) — Since you're already on Stripe, their Atlas guides cover billing models, tax, international expansion, and SaaS metrics.

## 3. Product-Led Growth & Retention

- **"Product-Led Growth" by Wes Bush** — How to make the product itself your primary acquisition and retention engine. Directly relevant to a self-serve SaaS.
- **"Hooked" by Nir Eyal** — Understanding habit loops for content creators who need to return daily/weekly to clip and distribute content.
- **"The Cold Start Problem" by Andrew Chen** — Network effects and marketplace dynamics. Relevant if you ever introduce shared feeds, collaboration, or a clip marketplace.

## 4. Marketing for Developer/Creator Tools

- **"Traction" by Gabriel Weinberg & Justin Mares** — Systematic framework for testing 19 marketing channels. Helps you figure out whether SEO, content marketing, paid ads, or community is your channel.
- **"Building a StoryBrand" by Donald Miller** — Clarifying your marketing message so content creators immediately understand what Polemicyst does for them.
- **"This Is Marketing" by Seth Godin** — Thinking about the minimum viable audience and finding your tribe of creators who need exactly what you're building.

## 5. Technical Architecture & Scaling

- **"Designing Data-Intensive Applications" by Martin Kleppmann** — The essential reference for your data pipeline (video processing queues, feed polling, transcript storage). Directly relevant to your BullMQ/PostgreSQL architecture.
- **"System Design Interview" by Alex Xu (Vol. 1 & 2)** — Practical patterns for video processing pipelines, rate limiting, notification systems, and content delivery — all things you're building.
- **"Web Scalability for Startup Engineers" by Artur Ejsmont** — Pragmatic scaling advice for when your user base grows beyond what a single server handles.

## 6. AI/ML in Production

- **"Building LLM Apps" by Valentino Gagliardi** — Practical patterns for integrating LLMs (you're using OpenAI for description generation and content analysis).
- **"AI Engineering" by Chip Huyen** — Covers the full lifecycle of AI in production: prompt management, evaluation, cost control, and reliability. Directly relevant to your transcript-to-clip pipeline.
- **OpenAI Cookbook** (https://cookbook.openai.com) — Hands-on recipes for the API you're already using. Covers structured outputs, function calling, and cost optimization.

## 7. Video & Media Technology

- **"FFmpeg Basics" by Frantisek Korbel** — FFmpeg is the backbone of any video clipping pipeline. Understanding it deeply will save you weeks of debugging.
- **"Digital Video: An Introduction to MPEG and the Standard" by Barry Haskell et al.** — Understanding codecs, containers, and transcoding at a conceptual level helps you make better architecture decisions.
- **AWS Media Services documentation** (https://docs.aws.amazon.com/mediaconvert/) — Since you're using S3, AWS MediaConvert/Elemental may be relevant for scaling video processing.

## 8. Legal, Compliance & Creator Economy

- **"The Personal MBA" by Josh Kaufman** — Broad business fundamentals without the MBA price tag. Covers contracts, accounting, operations, and more.
- **"Intellectual Property and Open Source" by Van Lindberg** — Understanding copyright around video content, fair use for clips, and platform terms of service.
- **Stripe Atlas legal guides** — Incorporation, terms of service templates, privacy policy frameworks. You already have TOS and privacy policy pages — these help keep them current.

## 9. Infrastructure & DevOps

- **"Terraform: Up & Running" by Yevgeniy Brikman** — You already have `main.tf` in your repo. This book covers patterns, modules, state management, and team workflows for Terraform.
- **"Docker Deep Dive" by Nigel Poulton** — You have a `docker-compose.yml`. This covers containerization patterns for your worker processes and local dev.
- **"The Phoenix Project" by Gene Kim** — A novel about DevOps culture. Useful framing for how to think about deployment pipelines, incident response, and shipping velocity as a solo/small team.

## 10. Solo Founder / Small Team Operations

- **"Company of One" by Paul Jarvis** — The case for staying small intentionally. Useful counterweight to "grow at all costs" advice.
- **"The E-Myth Revisited" by Michael Gerber** — Working *on* your business vs. *in* it. Important when you're the developer, marketer, and support team.
- **"Anything You Want" by Derek Sivers** — Short, opinionated lessons from building CD Baby. Good for calibrating your values as a founder.
- **"Shape Up" by Ryan Singer (free at basecamp.com/shapeup)** — Basecamp's product development methodology. Great for a small team shipping on 6-week cycles instead of endless sprints.

---

## Prioritized Starting Path

If you read nothing else, start with these five in order:

1. **"The Mom Test"** — Make sure you're building what creators actually need
2. **"Obviously Awesome"** — Nail your positioning against Opus Clip, Repurpose.io, etc.
3. **"Running Lean"** — Validate your business model before scaling
4. **"Designing Data-Intensive Applications"** — Get your video pipeline architecture right
5. **"Product-Led Growth"** — Design the product to sell itself
