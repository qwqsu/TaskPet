/** 最多保留三个约一秒的气泡；只存在内存中，不写入任何历史。 */
(() => {
interface KeyBubbleBridge {
  ready(): void;
  empty(sequence: number): void;
  onPush(callback: (event: { label: string; sequence: number }) => void): () => void;
}

const api = (window as unknown as { taskPetKeyBubbles: KeyBubbleBridge }).taskPetKeyBubbles;
const container = document.getElementById("bubbles") as HTMLElement;
const BUBBLE_LIFETIME_MS = 1_050;
const MAX_VISIBLE_BUBBLES = 3;
let latestSequence = 0;

function removeBubble(element: HTMLElement): void {
  element.remove();
  if (container.childElementCount === 0) api.empty(latestSequence);
}

function pushBubble(event: { label: string; sequence: number }): void {
  latestSequence = Math.max(latestSequence, event.sequence);
  const bubble = document.createElement("span");
  bubble.className = "key-bubble";
  bubble.textContent = [...event.label].slice(0, 8).join("");
  container.append(bubble);
  while (container.childElementCount > MAX_VISIBLE_BUBBLES) {
    container.firstElementChild?.remove();
  }
  window.setTimeout(() => removeBubble(bubble), BUBBLE_LIFETIME_MS);
}

const unsubscribe = api.onPush(pushBubble);
window.addEventListener("beforeunload", unsubscribe);
api.ready();
})();
