/**
 * Browser lab demo profile.
 * Highlights presets, practical tools, and report generation in a sandboxed profile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TaloxController, PRESETS, getPracticalTools } from 'talox';

async function main() {
  const talox = new TaloxController(path.resolve(process.cwd(), 'profiles'), {
    settings: {
      ...PRESETS.observe,
      humanTakeoverEnabled: true,
      autoHeadedEscalation: false,
      verbosity: 3,
      perceptionDepth: 'full',
    },
  });

  try {
    await talox.launch('browser-lab', 'sandbox', 'chromium', {
      headed: true,
      overlay: true,
      record: true,
      output: 'markdown',
      outputDir: path.resolve(process.cwd(), 'talox-sessions'),
    });

    const tools = getPracticalTools(talox);
    const state = await talox.navigate('https://example.com');
    console.log('Page title:', state.title);

    const searchHits = await tools.searchOnSite('example', 3);
    console.log('Search hits:', searchHits.map((hit) => hit.snippet).join(' | '));

    const bgTab = await tools.openBackgroundTab('https://example.com/about');
    console.log(bgTab.message);

    const api = await tools.captureApiResponse('https://example.com');
    console.log('API status:', api.status);

    await fs.promises.mkdir(path.resolve(process.cwd(), 'reports'), { recursive: true });
    const snapshot = await tools.exportMarkdownSnapshot(path.resolve(process.cwd(), 'reports/page.md'));
    console.log('Markdown snapshot:', snapshot);

    const structured = await tools.extractVisibleStructuredContent();
    console.log('Structured sections:', structured.sections.map((section) => section.heading).join(', '));
  } finally {
    await talox.stop();
  }
}

main().catch((error) => {
  console.error('Browser lab profile failed', error);
  process.exit(1);
});
