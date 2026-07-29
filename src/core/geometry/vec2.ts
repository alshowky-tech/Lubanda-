import { assertFiniteVec2 } from "./finite.js";
import type { Vec2 } from "./types.js";

export const add = (left: Vec2, right: Vec2): Vec2 => {
  assertFiniteVec2(left, "left");
  assertFiniteVec2(right, "right");
  return { x: left.x + right.x, y: left.y + right.y };
};

export const subtract = (left: Vec2, right: Vec2): Vec2 => {
  assertFiniteVec2(left, "left");
  assertFiniteVec2(right, "right");
  return { x: left.x - right.x, y: left.y - right.y };
};

export const scale = (point: Vec2, factor: number): Vec2 => {
  assertFiniteVec2(point);
  if (!Number.isFinite(factor)) throw new TypeError("factor must be finite");
  return { x: point.x * factor, y: point.y * factor };
};

export const dot = (left: Vec2, right: Vec2): number => {
  assertFiniteVec2(left, "left");
  assertFiniteVec2(right, "right");
  return left.x * right.x + left.y * right.y;
};

export const cross = (left: Vec2, right: Vec2): number => {
  assertFiniteVec2(left, "left");
  assertFiniteVec2(right, "right");
  return left.x * right.y - left.y * right.x;
};

export const lengthSquared = (point: Vec2): number => dot(point, point);

export const length = (point: Vec2): number => {
  assertFiniteVec2(point);
  return Math.hypot(point.x, point.y);
};

export const distance = (left: Vec2, right: Vec2): number => {
  assertFiniteVec2(left, "left");
  assertFiniteVec2(right, "right");
  return Math.hypot(left.x - right.x, left.y - right.y);
};

export const normalize = (point: Vec2, epsilon = 1e-9): Vec2 => {
  assertFiniteVec2(point);
  const magnitude = length(point);
  if (magnitude <= epsilon) throw new RangeError("Cannot normalize a zero-length vector");
  return { x: point.x / magnitude, y: point.y / magnitude };
};

export const lerp = (left: Vec2, right: Vec2, t: number): Vec2 => {
  assertFiniteVec2(left, "left");
  assertFiniteVec2(right, "right");
  if (!Number.isFinite(t)) throw new TypeError("t must be finite");
  return {
    x: left.x + (right.x - left.x) * t,
    y: left.y + (right.y - left.y) * t,
  };
};
