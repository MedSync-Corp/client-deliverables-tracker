
class KpiCard extends HTMLElement {
  static get observedAttributes() { return ['label','value','hint']; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  render() {
    const label = this.getAttribute('label') || 'Label';
    const value = this.getAttribute('value') || '-';
    const hint = this.getAttribute('hint') || '';
    this.innerHTML = `
      <div class="card">
        <div class="text-sm text-gray-500">${label}</div>
        <div class="text-3xl font-semibold mt-1">${value}</div>
        <div class="text-xs text-gray-400 mt-1">${hint}</div>
      </div>
    `;
  }
}
customElements.define('kpi-card', KpiCard);
