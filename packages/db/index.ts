export type { Prisma, PrismaClient } from './generated/prisma/client/client';
export { prisma } from './src/client';
export { _setNowProvider, now } from './src/clock';
export type { PrismaErrorInfo } from './src/errors';
export {
  formatPrismaError,
  getUserFriendlyMessage,
  isPrismaConnectionError,
  isPrismaConstraintError,
  isPrismaError,
  isPrismaTimeoutError,
  parsePrismaError,
} from './src/errors';
export type { DatabasePing } from './src/health';
export { pingDatabase } from './src/health';
export type { BuildPaginatorInput, Paginator } from './src/pagination';
export { buildPaginator } from './src/pagination';
export type {
  CategoryRecord,
  ManufacturerRecord,
  PermissionRecord,
  ProfileRecord,
  SettingRecord,
  ShopRecord,
  TagRecord,
  TypeRecord,
  UserRecord,
} from './src/records';
export type {
  CategoryAncestor,
  CategoryDescendant,
  CategoryTreeNode,
  ListCategoriesInput,
} from './src/repositories/categories.repository';
export {
  findCategoryByIdOrSlug,
  getCategoryTree,
  listCategories,
} from './src/repositories/categories.repository';
export type { ListManufacturersInput } from './src/repositories/manufacturers.repository';
export {
  findManufacturerBySlug,
  findOrCreateManufacturerBySlug,
  listManufacturers,
} from './src/repositories/manufacturers.repository';
export type {
  ListProductsInput,
  ProductDetail,
  ProductRecord,
  UpsertScrapedProductInput,
} from './src/repositories/products.repository';
export {
  DEFAULT_PAGE_SIZE,
  deleteScrapedProduct,
  findProductBySlug,
  IncompleteProvenanceError,
  InvalidSalePriceError,
  listProducts,
  MissingPriceError,
  upsertScrapedProduct,
} from './src/repositories/products.repository';
export { getSettings } from './src/repositories/settings.repository';
export type {
  ListShopsInput,
  ShopNearRecord,
} from './src/repositories/shops.repository';
export {
  findOrCreateShopBySlug,
  findShopBySlug,
  listShops,
  listShopsNear,
} from './src/repositories/shops.repository';
export type { ListTagsInput } from './src/repositories/tags.repository';
export { findTagBySlug, listTags } from './src/repositories/tags.repository';
export type { ListTypesInput } from './src/repositories/types.repository';
export { findTypeBySlug, listTypes } from './src/repositories/types.repository';
export type {
  CreateUserInput,
  ListUsersInput,
  UserCredentials,
  UserWithRelations,
} from './src/repositories/users.repository';
export {
  createUser,
  DuplicateEmailError,
  findUserById,
  findUserCredentialsByEmail,
  findUserWithRelations,
  listUsers,
  setUserActive,
  updateUserPasswordHash,
} from './src/repositories/users.repository';
