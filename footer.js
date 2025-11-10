
class AppFooter extends HTMLElement {
  connectedCallback() {
    const year = new Date().getFullYear();
    this.innerHTML = `
      <footer class="mt-16 border-t border-gray-200 py-8 text-center text-sm text-gray-500">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p>© ${year} Deliverables Tracker — Internal tool (no PHI)</p>
        </div>
      </footer>
    `;
  }
}
customElements.define('app-footer', AppFooter);
