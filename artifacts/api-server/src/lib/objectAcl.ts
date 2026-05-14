export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

export async function setObjectAclPolicy(
  _objectFile: any,
  _aclPolicy: ObjectAclPolicy,
): Promise<void> {
  // With Supabase Storage, ACL is managed at the bucket level (public bucket).
  // This is a no-op stub that maintains API compatibility.
}

export async function getObjectAclPolicy(
  _objectFile: any,
): Promise<ObjectAclPolicy | null> {
  // All objects in the public bucket are public by default
  return { owner: "system", visibility: "public" };
}

export async function canAccessObject({
  userId: _userId,
  objectFile: _objectFile,
  requestedPermission: _requestedPermission,
}: {
  userId?: string;
  objectFile: any;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  // With Supabase public bucket, all reads are allowed.
  // Write access is enforced by requiring auth at the route level.
  return true;
}
