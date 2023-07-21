import { Signal, _privates, cleanup } from "./signal";

/**
 * A non-empty list of consecutive nodes
 */
export type NodeList = [Node, ...Node[]];

declare global {
	namespace JSX {
		type Element = Node;

		interface ElementChildrenAttribute {
			children: {};
		}

		interface IntrinsicElements extends IntrinsicElementsMap {}

		// TODO
		type IntrinsicElementsMap = {
			[K in keyof HTMLElementTagNameMap]: {
				[k: string]: any;
			};
		};

		interface Component {
			(properties?: { [key: string]: any }, ...children: Node[]): Node;
		}
	}
}

export const attributeToProperty: { [key: string]: string } = {};

export function jsx(tag: string | JSX.Component, properties: { [key: string]: any }, ...children: Node[]): Node {
	if (typeof tag === "function") {
		return tag(Object.assign(properties ?? {}, { children }));
	}
	const element = document.createElement(tag);
	for (let child of children) {
		if (child instanceof Signal) child = signalToJSX(child);
		element.append(child);
	}
	if (!properties) return element;

	const fragment = new DocumentFragment();
	for (const key in properties) {
		const value = properties[key];
		if (key.startsWith("on")) {
			element.addEventListener(key.slice(2).toLowerCase(), value);
		} else if (value instanceof Signal) {
			const privates = _privates.get(value);
			if (!privates) continue;
			fragment.append(new Comment(`${privates.id}-${privates.nodes.length}`));
			const attribute = document.createAttribute(key);
			attribute.nodeValue = value.value;
			attributeToProperty[attribute.nodeName] = key;
			element.setAttributeNode(attribute);
			_privates.get(value)?.nodes.push(attribute);
		} else {
			element.setAttribute(key, "" + value);
		}
	}
	fragment.append(element);
	return fragment;
}

jsx.Fragments = function ({ children }: { children: Node[] }): Node {
	const fragment = new DocumentFragment();
	for (let child of children) {
		if (child instanceof Signal) child = signalToJSX(child);
		fragment.append(child);
	}
	return fragment;
};

function signalToJSX(signal: Signal<any>): Node {
	const fragment = new DocumentFragment();
	const privates = _privates.get(signal);
	if (!privates) return fragment;

	fragment.append(new Comment(`${privates.id}-${privates.nodes.length}`));
	const node = toNode(signal.value);
	privates.nodes.push(node);
	if (Array.isArray(node)) {
		for (const subnode of node) {
			fragment.append(subnode);
		}
	} else {
		fragment.append(node);
	}
	return fragment;
}

/**
 * Takes any value and converts it to a single usable DOM node or an array of nodes.
 *
 * Array are converted to an array of nodes. Empty arrays and null values are converted
 * to an empty Comment. Primitives are converted to a Text node.
 *
 * @throws If the value is an object that is neither an array or a DOM node
 */
export function toNode(value: any): Node | NodeList {
	if (Array.isArray(value)) {
		const res: Node[] = [];
		for (const el of value) {
			const node = toNode(el);
			if (Array.isArray(node)) {
				res.push(...node);
			} else {
				res.push(node);
			}
		}
		return res.length ? (res as NodeList) : new Comment("");
	}

	if (value === null) {
		return new Comment("");
	}

	if (value instanceof Node) {
		return value;
	}

	// TODO what about functions ?

	if (typeof value === "object" || typeof value === "function") {
		throw new Error("Objects are not valid elements.");
	}

	return new Text("" + value);
}

export function updateDOM(target: Node | NodeList, value: any) {
	return Array.isArray(target) ? updateMany(target, value) : updateOne(target, value);
}

/**
 * Updates a list of DOM nodes with new values. If it cannot update a given node, it
 * will replace it instead.
 *
 * @throws If the value is an object that is neither an array or a DOM node
 *
 * @returns If the node's value as updated, returns nothing. If it was replaced,
 * returns the new node(s).
 */
function updateMany(nodes: NodeList, value: any): Node | NodeList {
	if (nodes === value) return nodes;
	if (!Array.isArray(value)) {
		const first = nodes.shift()!;
		const parent = first.parentNode;
		if (!parent) return nodes;
		for (const node of nodes) {
			parent.removeChild(node);
		}
		return replaceNode(toNode(value), first);
	}

	const min = Math.min(value.length, nodes.length);
	const res: Node[] = [];
	for (let i = 0; i < min; i++) {
		const updated = updateOne(nodes[i], value[i]);
		if (Array.isArray(updated)) {
			// TODO shouldn't happen?
			res.push(...updated);
		} else {
			res.push(updated ?? nodes[i]);
		}
	}
	for (let i = min; i < nodes.length; i++) {
		nodes[i].parentNode?.removeChild(nodes[i]);
	}
	for (let i = min; i < value.length; i++) {
		const node = toNode(value[i]);
		insertAfter(node, res[res.length - 1]);
		if (Array.isArray(node)) {
			// TODO shouldn't happen?
			res.push(...node);
		} else {
			res.push(node);
		}
	}
	// final length is max(nodes.length, values.length)
	// nodes being a NodeList, res contains at least one element
	return res as NodeList;
}

/**
 * Updates a node in the DOM with a new value. If the value and node types are not
 * compatible, replaces the old node with a new one created from the value.
 *
 * @throws If the value is an object that is neither an array or a DOM node
 *
 * @returns The updated node
 */
function updateOne(node: Node, value: any): Node | NodeList {
	if (value === node) return node;
	if (Array.isArray(value)) {
		return replaceNode(toNode(value), node);
	}
	switch (node.nodeType) {
		case Node.ATTRIBUTE_NODE:
			node.nodeValue = value;
			updateOwnerProperty(node as Attr, value);
			return node;
		case Node.TEXT_NODE:
			if (typeof value !== "object") {
				node.nodeValue = value;
				return node;
			}
			return replaceNode(toNode(value), node);
		case Node.COMMENT_NODE:
			if (value === null) return node;
			return replaceNode(toNode(value), node);
		default:
			// default also handles node values
			return replaceNode(toNode(value), node);
	}
}

/**
 * Updates an attribute owner's corresponding property.
 *
 * For example, passing a "value" attribute node will update owner.value
 */
function updateOwnerProperty(attr: Attr, value: any): void {
	const owner = attr.ownerElement;
	if (!owner) return;
	const prop = attributeToProperty[attr.nodeName];
	if (owner.hasAttribute(prop)) {
		(owner as any)[prop] = value;
	}
}

/**
 * Removes a node from the DOM and replaces it with a single node or a list of at least
 * one node.
 *
 * @returns The inserted node(s).
 */
function replaceNode(node: Node, old: Node): Node;
function replaceNode(node: NodeList, old: Node): NodeList;
function replaceNode(node: Node | NodeList, old: Node): Node | NodeList;
function replaceNode(node: Node | NodeList, old: Node): Node | NodeList {
	if (!Array.isArray(node)) {
		old.parentNode?.replaceChild(node, old);
		cleanup(old);
		return node;
	}
	const last = node.pop();
	if (!last) throw new Error("Internal error: tried to insert an empty list of node");
	old.parentNode?.replaceChild(last, old);
	cleanup(old);
	for (const child of node) {
		old.parentNode?.insertBefore(child, last);
	}
	node.push(last);
	return node;
}

function insertAfter(node: Node | NodeList, target: Node) {
	if (!Array.isArray(node)) return target.parentNode?.insertBefore(node, target.nextSibling);
	for (const child of node) {
		target.parentNode?.insertBefore(child, target.nextSibling);
	}
}
