export function createElement(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, attrs = {}, dataset = {}, hidden, disabled } = options;
  if (className) node.className = Array.isArray(className) ? className.filter(Boolean).join(" ") : className;
  if (text !== undefined) node.textContent = String(text);
  if (hidden !== undefined) node.hidden = Boolean(hidden);
  if (disabled !== undefined) node.disabled = Boolean(disabled);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined) node.dataset[name] = String(value);
  }
  node.append(...children.filter(child => child !== null && child !== undefined && child !== ""));
  return node;
}

export function byId(id) {
  return document.getElementById(id);
}

export function textNode(value) {
  return document.createTextNode(String(value ?? ""));
}

export function replaceChildren(element, children = []) {
  element.replaceChildren(...children.filter(child => child !== null && child !== undefined && child !== ""));
}

// Interleave a separator between the non-empty nodes (no leading/trailing separator).
export function joinWithSeparator(nodes, makeSeparator) {
  const items = nodes.filter(node => node !== null && node !== undefined && node !== "");
  return items.flatMap((node, index) => (index > 0 ? [makeSeparator(), node] : [node]));
}
