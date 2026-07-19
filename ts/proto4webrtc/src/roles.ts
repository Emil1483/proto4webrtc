// A peer's access level on the signaling connection.
//
// Mirrors `enum Role` in proto/proto4webrtc/options.proto — the integer values
// ARE the wire format (stamped into the requests-channel appData.role and read
// back by the robot). Kept in sync by hand; the SFU runtime doesn't import
// generated option code.
//
// The SFU does NOT authenticate. The host application verifies each peer
// however it likes (JWT, session cookie, mTLS, ...), maps the result to a
// Role, and passes it to handleWSClient(). ROBOT is the default: pass nothing
// and every peer is a robot with full access — no-auth works out of the box.
export enum Role {
  /** Producer; everything an admin can, plus producing streams. Default / no-auth. */
  ROBOT = 0,
  /** Consumer, least privileged. Non-protected streams + rpc requests only. */
  GUEST = 1,
  /** Consumer. May consume protected streams and call protected rpc methods. */
  ADMIN = 2,
}
