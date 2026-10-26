/**
 * Highlighter del DOM.
 *
 * Mantiene el mapa de spans y aplica/retira los estilos del marcador. Se
 * separó del Reader para que la lógica de reproducción no manipule el DOM
 * directamente y para poder cambiar el estilo en caliente.
 */

import type { MarkerSettings } from '../types.js';

const ACTIVE_CLASS = 'reader-word-active';

const STYLE_PROPERTIES = [
  'display',
  'border-radius',
  'padding',
  'transition',
  'background-color',
  'color',
  'font-weight',
  'font-style',
  'text-decoration',
] as const;

export class Highlighter {
  private nodes = new Map<number, HTMLElement>();
  private settings: MarkerSettings;
  private activeNode: HTMLElement | null = null;
  private activeIndex: number | null = null;
  private appliedClasses: string[] = [];

  constructor(settings: MarkerSettings = {}) {
    this.settings = { ...settings };
  }

  /**
   * Vincula los spans de una nueva renderización.
   */
  public bind(nodes: Map<number, HTMLElement>): void {
    this.clear();
    this.nodes = nodes;
  }

  /**
   * Actualiza los estilos y reaplica el marcador activo si lo hubiera.
   */
  public update(settings: MarkerSettings): void {
    this.settings = { ...settings };

    if (this.activeIndex !== null) {
      const index = this.activeIndex;
      this.clear();
      this.highlight(index);
    }
  }

  public highlight(index: number): void {
    const node = this.nodes.get(index);
    if (!node) return;

    if (this.activeNode !== node) {
      this.clear();
    }

    this.activeNode = node;
    this.activeIndex = index;

    node.classList.add(ACTIVE_CLASS);

    const extraClasses = (this.settings.highlightClass ?? '').split(/\s+/).filter(Boolean);
    if (extraClasses.length > 0) {
      node.classList.add(...extraClasses);
      this.appliedClasses = extraClasses;
    }

    node.style.setProperty('display', 'inline-block');
    node.style.setProperty('border-radius', '4px');
    node.style.setProperty('padding', '0 4px');
    node.style.setProperty('transition', 'all 0.05s ease');

    if (this.settings.bgColor) {
      node.style.setProperty('background-color', this.settings.bgColor, 'important');
    }
    if (this.settings.color) {
      node.style.setProperty('color', this.settings.color, 'important');
    }
    if (this.settings.emphasis === 'bold') {
      node.style.setProperty('font-weight', 'bold');
    }
    if (this.settings.emphasis === 'italic') {
      node.style.setProperty('font-style', 'italic');
    }
    if (this.settings.emphasis === 'underline') {
      node.style.setProperty('text-decoration', 'underline');
    }
  }

  public clear(): void {
    const node = this.activeNode;
    if (!node) return;

    node.classList.remove(ACTIVE_CLASS);
    if (this.appliedClasses.length > 0) {
      node.classList.remove(...this.appliedClasses);
    }
    for (const property of STYLE_PROPERTIES) {
      node.style.removeProperty(property);
    }

    this.appliedClasses = [];
    this.activeNode = null;
    this.activeIndex = null;
  }
}
