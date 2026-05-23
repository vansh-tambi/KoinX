# Transaction Reconciliation Engine

A production-grade, modular Node.js backend application designed to ingest, normalize, and reconcile transaction data (specifically targeting crypto user ledgers vs. exchange data streams).

## Features & Highlights

- **Modular Architecture**: Clean separation of concerns with isolated modules for Ingestion, Matching, Reporting, and Jobs.
- **Stream-based Ingestion**: CSV ingestion utilizing `csv-parse` streams, allowing processing of multi-gigabyte files with low, stable memory footprints.
- **Repository Pattern**: Abstracted database interactions utilizing Mongoose models and a reusable `BaseRepository` wrapper.
- **Config-driven Tolerances**: Tolerances for transaction values and timestamp differences are managed externally via environment variables.
- **Async Queue Processing**: Employs `BullMQ` (backed by Redis) to manage CPU-heavy or high-latency reconciliation runs asynchronously.
- **Robust Schema & Enums**: Enforces normalization (lowercase to uppercase symbols, standard transaction types), custom validation rules (chronological ordering of run starts/completions), and raw audit logs storage so **no row is ever dropped**.

---

## Folder Structure

```
reconciliation-engine/
├── src/
│   ├── config/              # Configuration (Database, Redis, Tolerances)
│   ├── ingestion/           # Data Ingestion Layer
│   │   ├── parser/          # CSV Stream Parser
│   │   ├── validators/      # Zod Record Validation
│   │   └── normalizers/     # Asset, Type, Date Normalizers
│   ├── matching/            # Reconciliation Matching Layer
│   │   ├── strategy/        # Matching/Discrepancy logic
│   │   └── services/        # Matching orchestration services
│   ├── reporting/           # Report generation and export utilities
│   ├── routes/              # Express API Routes
│   ├── controllers/         # Express Controllers (Strictly request-handling)
│   ├── jobs/                # BullMQ queue & background worker setups
│   ├── middleware/          # Express global Middlewares
│   ├── models/              # Mongoose collection schemas
│   ├── repositories/        # Mongoose database abstraction wrappers
│   ├── utils/               # General utility helpers
│   └── app.js               # Main Express app bootstrap
├── samples/                 # Sample user & exchange transaction CSV files
├── uploads/                 # Storage for files awaiting ingestion
├── reports/                 # Storage folder for exported reports
├── tests/                   # Integration and unit test suites
├── .env                     # Local environment settings
├── .gitignore               # Excluded runtime/dependency files
├── package.json             # NPM package scripts & configuration
└── README.md                # Documentation (this file)
```

---

## Tech Stack

- **Runtime**: Node.js (ES Modules `"type": "module"`)
- **Web Framework**: Express
- **Database**: MongoDB (Mongoose 7+)
- **Queue/Worker**: BullMQ & Redis
- **Validation**: Zod
- **Parsing/Formatting**: csv-parse, csv-stringify
- **File Uploads**: Multer (configured folder stubs)

---

## Environment Variables Configuration

Copy `.env.example` to `.env` or create `.env` in the root:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/reconciliation
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Reconciliation thresholds
TOLERANCE_AMOUNT_DIFFERENCE=0.01
TOLERANCE_DATE_WINDOW_SECONDS=60
```

---

## Scripts & Run Commands

### Installation
Install project dependencies:
```bash
npm install
```

### Schema & Repository Verification Tests
Run the comprehensive verification suite to test Mongoose schemas, enums, compound unique indexes, and repository methods against an in-memory database:
```bash
npm run verify
```

### Start Local Development Server
Start the Express server in watch mode using `nodemon`:
```bash
npm run dev
```

### Start Production Server
```bash
npm run start
```
