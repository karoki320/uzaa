// Loyalty points (patch 22): on when the super admin gave the business the feature and the owner switched it on.
export const loyaltyOn = (b) => !!(b?.features?.loyalty && b?.loyalty_enabled);
// what a number of points takes off a sale
export const pointsWorth = (pts, b) => Math.round((Number(pts) || 0) * (Number(b?.loyalty_point_value) || 0) * 100) / 100;
