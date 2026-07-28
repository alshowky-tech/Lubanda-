export interface NumericPolicy {
  readonly epsilon: number;
}

export const DEFAULT_NUMERIC_POLICY: NumericPolicy = Object.freeze({
  epsilon: 1e-9,
});

export const assertNumericPolicy = (policy: NumericPolicy): void => {
  if (!Number.isFinite(policy.epsilon) || policy.epsilon <= 0) {
    throw new TypeError("Geometry epsilon must be positive and finite");
  }
};

