# Contributing to Talox

## Getting Started

```bash
git clone https://github.com/AVANT-ICONIC/Talox
cd Talox
npm install
npm run build
npm test
```

## Development

- Source is in `src/core/` — each sub-module has its own folder (`controller/`, `observe/`, `smart/`)
- Unit tests are in `tests/core/`
- E2E tests are in `tests/e2e/` (requires a built `dist/` and Playwright browsers)
- Examples are in `examples/`

## Running Tests

```bash
# Unit tests (fast, no browser required)
npm test

# E2E tests (requires Playwright browsers)
npx playwright install chromium
npm run test:e2e

# Full pre-publish gate (TypeScript + unit + E2E + build)
npm run test:publish
```

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

External contributions may be subject to a Contributor License Agreement (CLA) or Developer Certificate of Origin (DCO) as the project governance matures. By submitting a pull request, you confirm that you have the right to contribute the code and agree that it may be distributed under the project's license (AGPL-3.0-only).

## Code Style

- TypeScript strict mode (`exactOptionalPropertyTypes`, `nodenext` module)
- No `any` unless unavoidable (and add a comment explaining why)
- Keep modules focused — one responsibility per file
- Use `.js` extensions in all imports (ESM `nodenext` requirement)

## Reporting Issues

Open a GitHub issue at https://github.com/AVANT-ICONIC/Talox/issues with:
- What you were trying to do
- What happened
- Minimal reproduction steps
