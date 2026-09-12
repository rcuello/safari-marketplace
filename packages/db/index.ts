export type { Prisma, PrismaClient } from './generated/prisma/client/client';
export { prisma } from './src/client';
export { _setNowProvider, now } from './src/clock';
export type { CatalogErrorCode } from './src/domain-errors';
export {
  CATALOG_ERROR_CODES,
  CatalogWriteError,
  DependentRowsError,
  EmptySlugError,
  InvalidReferenceError,
  isCatalogWriteError,
  RecordNotFoundError,
  SlugConflictError,
  translateCatalogWriteError,
} from './src/domain-errors';
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
  CreateOtpCodeInput,
  CreatePasswordResetTokenInput,
  OtpCodeSecret,
  PasswordResetTokenSecret,
} from './src/repositories/auth-tokens.repository';
export {
  consumeOtpCode,
  consumePasswordResetToken,
  createOtpCode,
  createPasswordResetToken,
  findLiveOtpCodeById,
  findLivePasswordResetTokens,
  findUserIdByProfileContact,
  purgeExpiredAuthTokens,
} from './src/repositories/auth-tokens.repository';
export type {
  CategoryAncestor,
  CategoryDescendant,
  CategoryTreeNode,
  CreateCategoryInput,
  ListCategoriesInput,
  UpdateCategoryInput,
} from './src/repositories/categories.repository';
export {
  createCategory,
  deleteCategory,
  findCategoryByIdOrSlug,
  getCategoryTree,
  listCategories,
  updateCategory,
} from './src/repositories/categories.repository';
export type {
  CreateManufacturerInput,
  ListManufacturersInput,
  UpdateManufacturerInput,
} from './src/repositories/manufacturers.repository';
export {
  createManufacturer,
  deleteManufacturer,
  findManufacturerBySlug,
  findOrCreateManufacturerBySlug,
  listManufacturers,
  updateManufacturer,
} from './src/repositories/manufacturers.repository';
export type {
  CreateProductInput,
  ListProductsInput,
  ProductDetail,
  ProductRecord,
  UpdateProductInput,
  UpsertScrapedProductInput,
} from './src/repositories/products.repository';
export {
  createProduct,
  DEFAULT_PAGE_SIZE,
  deleteProduct,
  deleteScrapedProduct,
  findProductBySlug,
  findProductShopId,
  IncompleteProvenanceError,
  InvalidSalePriceError,
  listProducts,
  MissingPriceError,
  updateProduct,
  upsertScrapedProduct,
} from './src/repositories/products.repository';
export { getSettings } from './src/repositories/settings.repository';
export type {
  CreateShopInput,
  ListShopsInput,
  ShopNearRecord,
  UpdateShopInput,
} from './src/repositories/shops.repository';
export {
  createShop,
  findOrCreateShopBySlug,
  findShopBySlug,
  findShopOwnerById,
  listShops,
  listShopsNear,
  setShopActive,
  updateShop,
} from './src/repositories/shops.repository';
export type {
  CreateTagInput,
  ListTagsInput,
  UpdateTagInput,
} from './src/repositories/tags.repository';
export {
  createTag,
  deleteTag,
  findTagBySlug,
  listTags,
  updateTag,
} from './src/repositories/tags.repository';
export type {
  CreateTypeInput,
  ListTypesInput,
  UpdateTypeInput,
} from './src/repositories/types.repository';
export {
  createType,
  deleteType,
  findTypeBySlug,
  listTypes,
  updateType,
} from './src/repositories/types.repository';
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
  grantPermission,
  listUsers,
  listUsersWithRelations,
  setUserActive,
  updateUserPasswordHash,
} from './src/repositories/users.repository';
export type { ExistingSlugLookup, SlugSource } from './src/slug';
export { generateSlug, normalizeSlug } from './src/slug';
