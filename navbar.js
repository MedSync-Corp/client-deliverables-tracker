// navbar.js
class AppNavbar extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <nav class="bg-white border-b">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <a href="./index.html" class="flex items-center gap-2 font-semibold">
            <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-purple-600 text-white">▣</span>
            <span>Deliverables Tracker</span>
          </a>
          <div class="flex items-center gap-6 text-sm">
            <a href="./index.html" class="hover:text-gray-900 text-gray-700">Dashboard</a>
            <a href="./clients.html" class="hover:text-gray-900 text-gray-700">Clients</a>
            <a href="./partners.html" class="hover:text-gray-900 text-gray-700">Partners</a>
            <a href="#" id="navSignIn" class="px-3 py-1.5 rounded bg-purple-600 text-white text-sm">Sign In</a>
          </div>
        </div>
      </nav>
    `;
  }
}
customElements.define('app-navbar', AppNavbar);
