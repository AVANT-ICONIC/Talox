import type { TaloxNode } from '../types/index.js';

export interface SemanticEntity {
  id: string;
  type: SemanticEntityType;
  label: string;
  confidence: number;
  role: string;
  name: string;
  attributes: Record<string, string | boolean>;
  boundingBox: { x: number; y: number; width: number; height: number };
  metadata: Record<string, unknown>;
}

export type SemanticEntityType =
  | 'navigation'
  | 'form'
  | 'input'
  | 'button'
  | 'link'
  | 'article'
  | 'heading'
  | 'image'
  | 'list'
  | 'listItem'
  | 'dialog'
  | 'toolbar'
  | 'menu'
  | 'menuItem'
  | 'checkbox'
  | 'radio'
  | 'combobox'
  | 'search'
  | 'footer'
  | 'header'
  | 'main'
  | 'aside'
  | 'section'
  | 'unknown';

export interface KnowledgeProfile {
  domain: string;
  version: string;
  mappings: KnowledgeMapping[];
}

export interface KnowledgeMapping {
  selector: string;
  semanticType: SemanticEntityType;
  label: string;
  priority: number;
}

export interface SemanticMapperOptions {
  defaultConfidence: number;
  enableHeuristics: boolean;
  enableKnowledgeProfiles: boolean;
}

const DEFAULT_OPTIONS: SemanticMapperOptions = {
  defaultConfidence: 0.5,
  enableHeuristics: true,
  enableKnowledgeProfiles: true,
};

const DEFAULT_KNOWLEDGE_PROFILES: KnowledgeProfile[] = [
  {
    domain: 'github.com',
    version: '1.0.0',
    mappings: [
      { selector: '[data-testid="login-field"]', semanticType: 'input', label: 'username-input', priority: 10 },
      { selector: '#password', semanticType: 'input', label: 'password-input', priority: 10 },
      { selector: '[data-testid="login-submit"]', semanticType: 'button', label: 'login-button', priority: 10 },
      { selector: '[data-testid="search-input"]', semanticType: 'search', label: 'search-input', priority: 10 },
      { selector: '[data-testid="repository-list"]', semanticType: 'list', label: 'repository-list', priority: 5 },
      { selector: '[role="navigation"]', semanticType: 'navigation', label: 'main-navigation', priority: 8 },
    ],
  },
  {
    domain: 'twitter.com',
    version: '1.0.0',
    mappings: [
      { selector: '[data-testid="tweet-text"]', semanticType: 'article', label: 'tweet-content', priority: 10 },
      { selector: '[data-testid="tweetButton"]', semanticType: 'button', label: 'tweet-button', priority: 10 },
      { selector: '[data-testid="searchBoxInput"]', semanticType: 'search', label: 'search-input', priority: 10 },
      { selector: '[data-testid="sidebar"]', semanticType: 'navigation', label: 'sidebar-navigation', priority: 8 },
      { selector: '[role="navigation"]', semanticType: 'navigation', label: 'main-navigation', priority: 8 },
    ],
  },
  {
    domain: 'wikipedia.org',
    version: '1.0.0',
    mappings: [
      { selector: '#searchInput', semanticType: 'search', label: 'search-input', priority: 10 },
      { selector: '#searchButton', semanticType: 'button', label: 'search-button', priority: 10 },
      { selector: '#mw-head', semanticType: 'navigation', label: 'site-navigation', priority: 8 },
      { selector: '#mw-panel', semanticType: 'navigation', label: 'sidebar-navigation', priority: 8 },
      { selector: '.mw-parser-output', semanticType: 'article', label: 'article-content', priority: 8 },
      { selector: 'h1.firstHeading', semanticType: 'heading', label: 'page-title', priority: 10 },
    ],
  },
  {
    domain: 'reddit.com',
    version: '1.0.0',
    mappings: [
      { selector: '[data-testid="search-input"]', semanticType: 'search', label: 'search-input', priority: 10 },
      { selector: '[data-testid="post-content"]', semanticType: 'article', label: 'post-content', priority: 10 },
      { selector: '[data-testid="comment"]', semanticType: 'article', label: 'comment-content', priority: 8 },
      { selector: '[data-testid="submit-button"]', semanticType: 'button', label: 'submit-button', priority: 10 },
      { selector: '[role="navigation"]', semanticType: 'navigation', label: 'main-navigation', priority: 8 },
    ],
  },
  {
    domain: 'amazon.com',
    version: '1.0.0',
    mappings: [
      { selector: '#twotabsearchtextbox', semanticType: 'search', label: 'product-search', priority: 10 },
      { selector: '#nav-search-submit-button', semanticType: 'button', label: 'search-button', priority: 10 },
      { selector: '#nav-cart', semanticType: 'button', label: 'cart-button', priority: 10 },
      { selector: '#nav-signin-tooltip', semanticType: 'button', label: 'sign-in-button', priority: 10 },
      { selector: '[data-component-type="s-search-results"]', semanticType: 'list', label: 'product-list', priority: 8 },
    ],
  },
];

export class SemanticMapper {
  private options: SemanticMapperOptions;
  private knowledgeProfiles: KnowledgeProfile[];

  constructor(
    options: Partial<SemanticMapperOptions> = {},
    knowledgeProfiles: KnowledgeProfile[] = []
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.knowledgeProfiles = [...DEFAULT_KNOWLEDGE_PROFILES, ...knowledgeProfiles];
  }

  mapNode(node: TaloxNode, currentUrl?: string): SemanticEntity {
    const semanticType = this.determineSemanticType(node, currentUrl);
    const label = this.generateLabel(node, semanticType);
    const confidence = this.calculateConfidence(node, semanticType, currentUrl);

    return {
      id: node.id,
      type: semanticType,
      label,
      confidence,
      role: node.role,
      name: node.name,
      attributes: node.attributes || {},
      boundingBox: node.boundingBox,
      metadata: this.extractMetadata(node, semanticType),
    };
  }

  mapNodes(nodes: TaloxNode[], currentUrl?: string): SemanticEntity[] {
    return nodes.map((node) => this.mapNode(node, currentUrl));
  }

  addKnowledgeProfile(profile: KnowledgeProfile): void {
    const existingIndex = this.knowledgeProfiles.findIndex((p) => p.domain === profile.domain);
    if (existingIndex >= 0) {
      this.knowledgeProfiles[existingIndex] = profile;
    } else {
      this.knowledgeProfiles.push(profile);
    }
  }

  getKnowledgeProfile(domain: string): KnowledgeProfile | undefined {
    return this.knowledgeProfiles.find((p) => domain.includes(p.domain));
  }

  private determineSemanticType(node: TaloxNode, currentUrl?: string): SemanticEntityType {
    if (this.options.enableKnowledgeProfiles && currentUrl) {
      const profile = this.getKnowledgeProfile(currentUrl);
      if (profile) {
        const mapping = this.findBestMapping(node, profile);
        if (mapping) {
          return mapping.semanticType;
        }
      }
    }

    if (this.options.enableHeuristics) {
      return this.applyHeuristics(node);
    }

    return this.roleToSemanticType(node.role);
  }

  private findBestMapping(node: TaloxNode, profile: KnowledgeProfile): KnowledgeMapping | null {
    const sortedMappings = profile.mappings
      .filter((mapping) => this.matchesSelector(node, mapping.selector))
      .sort((a, b) => b.priority - a.priority);

    return sortedMappings[0] || null;
  }

  private matchesSelector(node: TaloxNode, selector: string): boolean {
    const attrs = node.attributes || {};
    
    if (selector.startsWith('[data-testid=')) {
      const testIdMatch = selector.match(/\[data-testid="([^"]+)"\]/);
      if (testIdMatch) {
        return attrs['data-testid'] === testIdMatch[1];
      }
    }

    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return attrs['id'] === id || node.id === id;
    }

    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      const classAttr = attrs['class'];
      if (typeof classAttr === 'string') {
        return classAttr.includes(className);
      }
      return false;
    }

    if (selector.startsWith('[role=')) {
      const roleMatch = selector.match(/\[role="([^"]+)"\]/);
      if (roleMatch && roleMatch[1]) {
        return node.role.toLowerCase() === roleMatch[1].toLowerCase();
      }
    }

    return false;
  }

  private applyHeuristics(node: TaloxNode): SemanticEntityType {
    const role = node.role.toLowerCase();
    const name = node.name.toLowerCase();
    const description = node.description?.toLowerCase() || '';
    const attrs = node.attributes || {};

    if (role === 'navigation' || role === 'menubar' || role === 'tree') {
      return 'navigation';
    }

    if (role === 'textbox' || role === 'searchbox') {
      if (this.matchesSearchKeywords(name) || this.matchesSearchKeywords(description)) {
        return 'search';
      }
      if (this.matchesPasswordKeywords(name) || this.matchesPasswordKeywords(description)) {
        return 'input';
      }
      return 'input';
    }

    if (role === 'combobox' || role === 'listbox') {
      return 'combobox';
    }

    if (role === 'button' || role === 'menuitem' || role === 'tab') {
      if (this.matchesSubmitKeywords(name) || this.matchesSubmitKeywords(description)) {
        return 'button';
      }
      return 'button';
    }

    if (role === 'link') {
      return 'link';
    }

    if (role === 'checkbox') {
      return 'checkbox';
    }

    if (role === 'radio') {
      return 'radio';
    }

    if (role === 'img' || role === 'image') {
      return 'image';
    }

    if (role === 'heading') {
      return 'heading';
    }

    if (role === 'list' || role === 'tree') {
      return 'list';
    }

    if (role === 'listitem') {
      return 'listItem';
    }

    if (role === 'dialog' || role === 'alert' || role === 'alertdialog') {
      return 'dialog';
    }

    if (role === 'toolbar') {
      return 'toolbar';
    }

    if (role === 'menu' || role === 'menupopup') {
      return 'menu';
    }

    if (role === 'menuitem') {
      return 'menuItem';
    }

    if (role === 'article' || role === 'document') {
      return 'article';
    }

    if (role === 'form') {
      return 'form';
    }

    if (role === 'region') {
      if (this.matchesHeaderKeywords(name)) {
        return 'header';
      }
      if (this.matchesFooterKeywords(name)) {
        return 'footer';
      }
      if (this.matchesAsideKeywords(name)) {
        return 'aside';
      }
      if (this.matchesMainKeywords(name)) {
        return 'main';
      }
      return 'section';
    }

    return 'unknown';
  }

  private roleToSemanticType(role: string): SemanticEntityType {
    const roleMap: Record<string, SemanticEntityType> = {
      navigation: 'navigation',
      menubar: 'navigation',
      form: 'form',
      textbox: 'input',
      searchbox: 'search',
      combobox: 'combobox',
      button: 'button',
      link: 'link',
      checkbox: 'checkbox',
      radio: 'radio',
      img: 'image',
      image: 'image',
      heading: 'heading',
      list: 'list',
      listitem: 'listItem',
      dialog: 'dialog',
      alert: 'dialog',
      alertdialog: 'dialog',
      toolbar: 'toolbar',
      menu: 'menu',
      menupopup: 'menu',
      menuitem: 'menuItem',
      article: 'article',
      document: 'article',
      region: 'section',
      footer: 'footer',
      header: 'header',
      main: 'main',
      complementary: 'aside',
    };

    return roleMap[role.toLowerCase()] || 'unknown';
  }

  private generateLabel(node: TaloxNode, semanticType: SemanticEntityType): string {
    const name = node.name.trim();
    const role = node.role.toLowerCase();
    const attrs = node.attributes || {};

    if (name) {
      const normalized = this.normalizeLabel(name);
      if (this.isGenericName(name)) {
        return this.generateLabelFromType(semanticType, role);
      }
      return normalized;
    }

    const dataTestId = attrs['data-testid'] as string;
    if (dataTestId) {
      return dataTestId;
    }

    const ariaLabel = attrs['aria-label'] as string;
    if (ariaLabel) {
      return this.normalizeLabel(ariaLabel);
    }

    const placeholder = attrs['placeholder'] as string;
    if (placeholder) {
      return this.normalizeLabel(placeholder);
    }

    return this.generateLabelFromType(semanticType, role);
  }

  private normalizeLabel(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  private isGenericName(name: string): boolean {
    const genericNames = [
      '',
      'button',
      'submit',
      'click',
      'link',
      'input',
      'text',
      'field',
      'box',
      'container',
      'item',
      'element',
      'node',
    ];
    return genericNames.includes(name.toLowerCase().trim());
  }

  private generateLabelFromType(semanticType: SemanticEntityType, role: string): string {
    const typeLabels: Record<SemanticEntityType, string> = {
      navigation: 'navigation',
      form: 'form',
      input: 'input-field',
      button: 'button',
      link: 'link',
      article: 'article',
      heading: 'heading',
      image: 'image',
      list: 'list',
      listItem: 'list-item',
      dialog: 'dialog',
      toolbar: 'toolbar',
      menu: 'menu',
      menuItem: 'menu-item',
      checkbox: 'checkbox',
      radio: 'radio-button',
      combobox: 'dropdown',
      search: 'search-input',
      footer: 'footer',
      header: 'header',
      main: 'main-content',
      aside: 'sidebar',
      section: 'section',
      unknown: 'element',
    };

    return typeLabels[semanticType] || `${role}-element`;
  }

  private calculateConfidence(node: TaloxNode, semanticType: SemanticEntityType, currentUrl?: string): number {
    let confidence = this.options.defaultConfidence;
    const name = node.name.trim();
    const attrs = node.attributes || {};

    if (semanticType === 'unknown') {
      confidence = 0.3;
    } else {
      confidence += 0.2;
    }

    if (name && !this.isGenericName(name)) {
      confidence += 0.2;
    }

    if (attrs['data-testid']) {
      confidence += 0.3;
    }

    if (attrs['aria-label'] || attrs['aria-labelledby']) {
      confidence += 0.15;
    }

    if (currentUrl && this.options.enableKnowledgeProfiles) {
      const profile = this.getKnowledgeProfile(currentUrl);
      if (profile) {
        const mapping = this.findBestMapping(node, profile);
        if (mapping) {
          confidence = Math.min(1.0, confidence + 0.2);
        }
      }
    }

    return Math.min(1.0, Math.max(0.0, confidence));
  }

  private extractMetadata(node: TaloxNode, semanticType: SemanticEntityType): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      originalRole: node.role,
      hasDescription: !!node.description,
    };

    const attrs = node.attributes || {};

    if (attrs['data-testid']) {
      metadata.dataTestId = attrs['data-testid'];
    }

    if (attrs['aria-label']) {
      metadata.ariaLabel = attrs['aria-label'];
    }

    if (attrs['aria-labelledby']) {
      metadata.ariaLabelledBy = attrs['aria-labelledby'];
    }

    if (attrs['id']) {
      metadata.elementId = attrs['id'];
    }

    if (attrs['class']) {
      metadata.className = attrs['class'];
    }

    metadata.isInteractive = this.isInteractiveType(semanticType);

    return metadata;
  }

  private isInteractiveType(semanticType: SemanticEntityType): boolean {
    const interactiveTypes: SemanticEntityType[] = [
      'button',
      'link',
      'input',
      'search',
      'checkbox',
      'radio',
      'combobox',
      'menuItem',
    ];
    return interactiveTypes.includes(semanticType);
  }

  private matchesSearchKeywords(text: string): boolean {
    const searchKeywords = ['search', 'find', 'query', 'type here', 'looking for'];
    return searchKeywords.some((keyword) => text.includes(keyword));
  }

  private matchesPasswordKeywords(text: string): boolean {
    const passwordKeywords = ['password', 'passwd', 'pwd', 'secret'];
    return passwordKeywords.some((keyword) => text.includes(keyword));
  }

  private matchesSubmitKeywords(text: string): boolean {
    const submitKeywords = ['submit', 'send', 'post', 'publish', 'save', 'confirm', 'create', 'update'];
    return submitKeywords.some((keyword) => text.includes(keyword));
  }

  private matchesHeaderKeywords(text: string): boolean {
    const headerKeywords = ['header', 'top', 'banner'];
    return headerKeywords.some((keyword) => text.includes(keyword));
  }

  private matchesFooterKeywords(text: string): boolean {
    const footerKeywords = ['footer', 'bottom', 'copyright', 'links'];
    return footerKeywords.some((keyword) => text.includes(keyword));
  }

  private matchesAsideKeywords(text: string): boolean {
    const asideKeywords = ['sidebar', 'aside', 'right', 'left', 'related'];
    return asideKeywords.some((keyword) => text.includes(keyword));
  }

  private matchesMainKeywords(text: string): boolean {
    const mainKeywords = ['main', 'content', 'body', 'primary'];
    return mainKeywords.some((keyword) => text.includes(keyword));
  }

  filterByType(entities: SemanticEntity[], types: SemanticEntityType[]): SemanticEntity[] {
    return entities.filter((entity) => types.includes(entity.type));
  }

  filterInteractive(entities: SemanticEntity[]): SemanticEntity[] {
    return entities.filter((entity) => this.isInteractiveType(entity.type));
  }

  findByLabel(entities: SemanticEntity[], labelPattern: string): SemanticEntity[] {
    const regex = new RegExp(labelPattern, 'i');
    return entities.filter((entity) => regex.test(entity.label));
  }

  getEntitiesByConfidence(entities: SemanticEntity[], minConfidence: number): SemanticEntity[] {
    return entities.filter((entity) => entity.confidence >= minConfidence);
  }

  sortByPosition(entities: SemanticEntity[]): SemanticEntity[] {
    return [...entities].sort((a, b) => {
      const yDiff = a.boundingBox.y - b.boundingBox.y;
      if (Math.abs(yDiff) > 20) {
        return yDiff;
      }
      return a.boundingBox.x - b.boundingBox.x;
    });
  }

  groupByType(entities: SemanticEntity[]): Map<SemanticEntityType, SemanticEntity[]> {
    const groups = new Map<SemanticEntityType, SemanticEntity[]>();
    
    for (const entity of entities) {
      const existing = groups.get(entity.type) || [];
      existing.push(entity);
      groups.set(entity.type, existing);
    }

    return groups;
  }
}

export function createSemanticMapper(
  options?: Partial<SemanticMapperOptions>,
  knowledgeProfiles?: KnowledgeProfile[]
): SemanticMapper {
  return new SemanticMapper(options, knowledgeProfiles);
}
