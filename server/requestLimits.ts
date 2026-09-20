// Backups embed originals and must not be constrained by an HTTP body-size cap.
// Individual upload routes retain their own file/type limits after authentication.
export const maxRequestBodySize = Infinity;
