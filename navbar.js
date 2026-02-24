// navbar.js
class AppNavbar extends HTMLElement {
  connectedCallback() {
    const path = window.location.pathname;
    const isActive = (page) => {
      if (page === 'index.html') {
        return path.endsWith('index.html') || path.endsWith('/');
      }
      return path.endsWith(page);
    };
    
    const linkClass = (page) => isActive(page)
      ? 'text-purple-600 font-medium'
      : 'text-gray-700 hover:text-gray-900';

    this.innerHTML = `
      <nav class="bg-white border-b">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <a href="./index.html" class="flex items-center gap-3 font-semibold">
            <img src="./medsync-logo-horizontal.svg" alt="MedSync" class="h-7" />
            <span class="text-gray-400">|</span>
            <span>Deliverables Tracker</span>
          </a>
          <div class="flex items-center gap-6 text-sm">
            <a href="./index.html" class="${linkClass('index.html')}">Dashboard</a>
            <a href="./clients.html" class="${linkClass('clients.html')}">Clients</a>
            <a href="./partners.html" class="${linkClass('partners.html')}">Partners</a>
            <a href="./staffing.html" class="${linkClass('staffing.html')}">Staffing</a>
            <button id="logoutBtn" class="px-3 py-1.5 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm">Sign Out</button>
          </div>
        </div>
      </nav>
    `;
  }
}
customElements.define('app-navbar', AppNavbar);
