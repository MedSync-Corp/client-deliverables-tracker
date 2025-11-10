
class StatusBadge extends HTMLElement {
  static get observedAttributes() { return ['status']; }
  connectedCallback(){ this.render(); }
  attributeChangedCallback(){ this.render(); }
  render(){
    const status = (this.getAttribute('status') || 'green').toLowerCase();
    const cls = status === 'red' ? 'red' : status === 'yellow' ? 'yellow' : 'green';
    const text = status.charAt(0).toUpperCase() + status.slice(1);
    this.innerHTML = `<span class="badge ${cls}">${text}</span>`;
  }
}
customElements.define('status-badge', StatusBadge);
