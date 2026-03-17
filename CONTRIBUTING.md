# Contributing to Talox

## Getting Started

```bash
git clone https://github.com/AVANT-ICONIC/Talox
cd talox
npm install
npm run build
npm test
```

## Development

- Source is in `src/`
- Tests are in `tests/`
- Examples are in `examples/`

## Tesseract OCR Data

Debug mode OCR requires the Tesseract English language model. Download it once:

```bash
curl -L https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata -o eng.traineddata
```

## Pull Requests

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes in `src/`
4. Run `npm run build && npm test`
5. Open a Pull Request

## Code Style

- TypeScript strict mode
- No `any` unless unavoidable
- Keep modules focused — one responsibility per file

## Reporting Issues

Open a GitHub issue with:
- What you were trying to do
- What happened
- Minimal reproduction steps
