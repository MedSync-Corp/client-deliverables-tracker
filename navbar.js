
class AppNavbar extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="w-full bg-white border-b border-gray-200">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <a href="./index.html" class="flex items-center gap-2 font-semibold">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7h6v6H3zM15 7h6v6h-6zM9 17h6v6H9z" />
            </svg>
            <span>Deliverables Tracker</span>
          </a>
          <nav class="flex items-center gap-6 text-sm">
            <a href="./index.html" class="hover:text-indigo-600">Dashboard</a>
            <a href="./clients.html" class="hover:text-indigo-600">Clients</a>
            <!-- Placeholder auth controls -->
            <button id="auth-btn" class="px-3 py-1 rounded-md bg-indigo-600 text-white text-sm">Sign In</button>
          </nav>
        </div>
      </header>
    `;
  }
}
customElements.define('app-navbar', AppNavbar);
