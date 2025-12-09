// toast.js - Simple toast notification system
class ToastContainer extends HTMLElement {
  connectedCallback() {
    this.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
  }
}
customElements.define('toast-container', ToastContainer);

// Toast types and their styles
const TOAST_STYLES = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-yellow-500 text-white',
  info: 'bg-gray-800 text-white'
};

// Create container if it doesn't exist
function getContainer() {
  let container = document.querySelector('toast-container');
  if (!container) {
    container = document.createElement('toast-container');
    document.body.appendChild(container);
  }
  return container;
}

// Show a toast notification
export function showToast(message, type = 'info', duration = 3000) {
  const container = getContainer();
  
  const toast = document.createElement('div');
  toast.className = `${TOAST_STYLES[type] || TOAST_STYLES.info} px-4 py-3 rounded-lg shadow-lg transform transition-all duration-300 ease-out translate-x-full opacity-0 flex items-center gap-2 min-w-[200px] max-w-sm`;
  
  // Icon based on type
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <span class="text-lg">${icons[type] || icons.info}</span>
    <span class="flex-1">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
  });
  
  // Auto remove
  setTimeout(() => {
    toast.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
  
  return toast;
}

// Convenience methods
export const toast = {
  success: (msg, duration) => showToast(msg, 'success', duration),
  error: (msg, duration) => showToast(msg, 'error', duration),
  warning: (msg, duration) => showToast(msg, 'warning', duration),
  info: (msg, duration) => showToast(msg, 'info', duration)
};
