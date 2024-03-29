import { isSignal } from "../src/signal";
import { createStore } from "../src/store";

describe("Store type", () => {
	// Test for non-TS use
	it("may only be intialized with objects", () => {
		expect(() => createStore(0 as any)).toThrow();
		expect(() => createStore(null as any)).toThrow();
	});

	it("should be a valid signal", () => {
		const x = createStore({});
		expect(isSignal(x)).toBe(true);
	});

	it("should return a reactive value when properties are accessed", () => {
		const x = createStore({ counter: { value: 0 } });
		const y = x.counter;
		expect(isSignal(y)).toBe(true);
		const z = y.value;
		expect(isSignal(z)).toBe(true);
	});

	it("should be settable", () => {
		const s = createStore<Record<string, any>>({ key: "value" });
		s.set({ foo: "bar" });
		expect(s()).toEqual({ foo: "bar" });
		const t = s.foo;
		s.set({ foo: "baz" });
		expect(t()).toBe("baz");
		s.foo.set("42");
		expect(s().foo).toBe("42");
		expect(t()).toBe("42");
	});

	it("should handle arrays", () => {
		const s = createStore([0, 1, 2]);
		expect(s.length()).toBe(3);
		s.set((array) => [...array, array.length]);
		expect(s.length()).toBe(4);
	});
});
