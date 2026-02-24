// log-modal.js - Reusable log completion modal component
class LogModal extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="logModal" class="fixed inset-0 bg-black/40 hidden items-center justify-center p-4 z-50">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold">Log entry</h3>
            <button id="logClose" class="text-gray-500 hover:text-gray-700">&times;</button>
          </div>
          <p class="text-sm text-gray-600 mb-3">Client: <span id="logClientName" class="font-medium">—</span></p>
          <form id="logForm" class="space-y-3">
            <input type="hidden" name="client_id" />

            <!-- Entry type toggle -->
            <div>
              <label class="block text-sm mb-2">Entry type</label>
              <div class="flex gap-2">
                <label class="flex-1">
                  <input type="radio" name="log_type" value="completed" class="sr-only peer" checked />
                  <div class="text-center px-3 py-2 border rounded-lg cursor-pointer peer-checked:bg-gray-900 peer-checked:text-white peer-checked:border-gray-900 hover:bg-gray-50 peer-checked:hover:bg-gray-800 transition-colors">
                    Completed RECAPs
                  </div>
                </label>
                <label class="flex-1">
                  <input type="radio" name="log_type" value="utc" class="sr-only peer" />
                  <div class="text-center px-3 py-2 border rounded-lg cursor-pointer peer-checked:bg-amber-500 peer-checked:text-white peer-checked:border-amber-500 hover:bg-gray-50 peer-checked:hover:bg-amber-600 transition-colors">
                    UTCs
                  </div>
                </label>
              </div>
            </div>

            <!-- Work date field -->
            <div>
              <label class="block text-sm mb-1">Work date</label>
              <input
                name="occurred_on"
                type="date"
                class="w-full border rounded-lg px-3 py-2"
                required
              />
              <p class="mt-1 text-xs text-gray-500">
                Defaults to today. Change this if you are logging work from a previous day.
              </p>
            </div>

            <div>
              <label class="block text-sm mb-1">Quantity (use negative to correct mistakes)</label>
              <input
                name="qty"
                type="number"
                step="1"
                class="w-full border rounded-lg px-3 py-2"
                required
              />
            </div>

            <div>
              <label class="block text-sm mb-1">Note (optional)</label>
              <input
                name="note"
                type="text"
                class="w-full border rounded-lg px-3 py-2"
              />
            </div>

            <div class="flex items-center justify-end gap-2">
              <button type="button" id="logCancel" class="px-3 py-2 rounded border">
                Cancel
              </button>
              <button type="submit" class="px-3 py-2 rounded bg-gray-900 text-white">
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
}
customElements.define('log-modal', LogModal);
