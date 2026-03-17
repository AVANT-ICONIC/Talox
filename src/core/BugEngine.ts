import type { TaloxBug } from '../types/index.js';

export class BugEngine {
  formatReport(bug: TaloxBug): string {
    return `
## [${bug.type}] ${bug.description}
- **Severity:** ${bug.severity}
- **ID:** ${bug.id}
- **Evidence:** 
\`\`\`json
${JSON.stringify(bug.evidence, null, 2)}
\`\`\`
    `.trim();
  }

  generateReport(bugs: TaloxBug[]): string {
    if (bugs.length === 0) return "# Bug Report\nNo bugs detected.";
    
    return `
# Talox Bug Report
Detected ${bugs.length} potential issues.

${bugs.map(bug => this.formatReport(bug)).join('\n\n---\n\n')}
    `.trim();
  }
}
