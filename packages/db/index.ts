export type { Prisma, PrismaClient } from './generated/prisma/client/client';
/** Aritmética decimal exacta (la de `numeric`); la usa el cálculo del checkout. */
export { Decimal } from './generated/prisma/client/internal/prismaNamespace';
export { prisma } from './src/client';
export { _setNowProvider, now } from './src/clock';
export type { CatalogErrorCode } from './src/domain-errors';
export {
  CATALOG_ERROR_CODES,
  CatalogWriteError,
  DependentRowsError,
  EmptySlugError,
  InvalidFieldValueError,
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
  AbusiveReportRecord,
  AttributeRecord,
  AttributeValueRecord,
  BecomeSellerRecord,
  CategoryRecord,
  ConversationRecord,
  CouponRecord,
  FaqRecord,
  ManufacturerRecord,
  MessageRecord,
  OrderFileRecord,
  OrderProductRecord,
  OrderRecord,
  OrderStatusRecord,
  OwnershipTransferRecord,
  PermissionRecord,
  ProfileRecord,
  QuestionRecord,
  RefundPolicyRecord,
  RefundReasonRecord,
  ReviewRecord,
  SettingRecord,
  ShippingRecord,
  ShopRecord,
  ShopStaffRecord,
  StoreNoticeCreatorRecord,
  StoreNoticeDetailRecord,
  StoreNoticeReadRecord,
  StoreNoticeRecord,
  TagRecord,
  TaxRecord,
  TermsAndConditionsRecord,
  TypeRecord,
  UserRecord,
  WithdrawRecord,
} from './src/records';
export type {
  AbusiveReportDetailRecord,
  CreateAbusiveReportInput,
} from './src/repositories/abusive-reports.repository';
export {
  assertReportableExists,
  createAbusiveReport,
  deleteAbusiveReport,
  findAbusiveReportById,
  listAbusiveReports,
  listAbusiveReportsByUser,
  REPORTABLE_MODEL_TYPES,
  rejectAbusiveReports,
  updateAbusiveReport,
} from './src/repositories/abusive-reports.repository';
export type {
  AnalyticsListInput,
  CategoryProductCountRecord,
  DashboardAnalyticsRecord,
  OrderStatusCounts,
  TopRatedProductRecord,
} from './src/repositories/analytics.repository';
export {
  getDashboardAnalytics,
  listCategoryWiseProductCounts,
  listLowStockProducts,
  listTopRatedProducts,
} from './src/repositories/analytics.repository';
export type {
  AttributeValueInput,
  CreateAttributeInput,
  ListAttributesInput,
  UpdateAttributeInput,
} from './src/repositories/attributes.repository';
export {
  createAttribute,
  deleteAttribute,
  findAttributeByIdOrSlug,
  listAttributes,
  updateAttribute,
} from './src/repositories/attributes.repository';
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
export type { UpdateBecomeSellerInput } from './src/repositories/become-seller.repository';
export {
  getBecomeSeller,
  updateBecomeSeller,
} from './src/repositories/become-seller.repository';
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
  ConversationDetailRecord,
  ConversationSortField,
  ConversationViewer,
  ListConversationsInput,
  MessageDetailRecord,
} from './src/repositories/conversations.repository';
export {
  CONVERSATION_SORTABLE,
  createMessage,
  findConversationById,
  findOrCreateConversation,
  listConversations,
  listMessages,
  markConversationSeen,
} from './src/repositories/conversations.repository';
export type {
  CreateCouponInput,
  ListCouponsInput,
  UpdateCouponInput,
} from './src/repositories/coupons.repository';
export {
  COUPON_TYPES,
  createCoupon,
  deleteCoupon,
  findCouponByCode,
  findCouponById,
  listCoupons,
  setCouponApproval,
  updateCoupon,
} from './src/repositories/coupons.repository';
export type {
  CreateFaqInput,
  ListFaqsInput,
  UpdateFaqInput,
} from './src/repositories/faqs.repository';
export {
  createFaq,
  deleteFaq,
  findFaqById,
  GLOBAL_CONTENT_ISSUER,
  listFaqs,
  updateFaq,
} from './src/repositories/faqs.repository';
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
export type { ListOrderFilesInput } from './src/repositories/order-files.repository';
export {
  findFirstOrderFileByDigitalFileId,
  listOrderFilesByCustomer,
} from './src/repositories/order-files.repository';
export type {
  CreateOrderStatusInput,
  ListOrderStatusesInput,
  OrderStatusSortField,
  UpdateOrderStatusInput,
} from './src/repositories/order-statuses.repository';
export {
  createOrderStatus,
  deleteOrderStatus,
  findOrderStatusBySlug,
  listOrderStatuses,
  ORDER_STATUS_SORTABLE,
  updateOrderStatus,
} from './src/repositories/order-statuses.repository';
export type {
  CreateOrderChildInput,
  CreateOrderInput,
  ListOrdersInput,
  OrderDetailRecord,
  OrderLineInput,
} from './src/repositories/orders.repository';
export {
  createOrderWithChildren,
  deleteOrder,
  findOrderByIdOrTracking,
  findProductsForOrder,
  InsufficientStockError,
  listOrders,
  markOrderPaid,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  setOrderStatus,
} from './src/repositories/orders.repository';
export type {
  CreateOwnershipTransferInput,
  ListOwnershipTransfersInput,
  OwnershipTransferDetailRecord,
  OwnershipTransferOwnerRecord,
  ShopTransferResult,
  TransferShopOwnershipInput,
  UpdateOwnershipTransferInput,
} from './src/repositories/ownership-transfers.repository';
export {
  createOwnershipTransfer,
  deleteOwnershipTransfer,
  findOwnershipTransferByIdentifier,
  listOwnershipTransfers,
  OWNERSHIP_TRANSFER_STATUSES,
  SameOwnerError,
  transferShopOwnership,
  updateOwnershipTransfer,
} from './src/repositories/ownership-transfers.repository';
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
export type {
  CreateQuestionInput,
  ListQuestionsInput,
  QuestionDetailRecord,
} from './src/repositories/questions.repository';
export {
  answerQuestion,
  createQuestion,
  deleteQuestion,
  findQuestionById,
  listQuestions,
  listUserQuestions,
  updateQuestionText,
} from './src/repositories/questions.repository';
export type {
  CreateRefundPolicyInput,
  ListRefundPoliciesInput,
  UpdateRefundPolicyInput,
} from './src/repositories/refund-policies.repository';
export {
  createRefundPolicy,
  deleteRefundPolicy,
  findRefundPolicyBySlug,
  listRefundPolicies,
  REFUND_POLICY_STATUSES,
  REFUND_POLICY_TARGETS,
  updateRefundPolicy,
} from './src/repositories/refund-policies.repository';
export type {
  CreateRefundReasonInput,
  ListRefundReasonsInput,
  UpdateRefundReasonInput,
} from './src/repositories/refund-reasons.repository';
export {
  createRefundReason,
  deleteRefundReason,
  findRefundReasonBySlug,
  listRefundReasons,
  updateRefundReason,
} from './src/repositories/refund-reasons.repository';
export type {
  CreateReviewInput,
  ListReviewsInput,
  ReviewDetailRecord,
  UpdateReviewInput,
} from './src/repositories/reviews.repository';
export {
  createReview,
  deleteReview,
  findReviewById,
  listReviews,
  updateReview,
} from './src/repositories/reviews.repository';
export { getSettings } from './src/repositories/settings.repository';
export type {
  CreateShippingInput,
  ListShippingsInput,
  UpdateShippingInput,
} from './src/repositories/shippings.repository';
export {
  createShipping,
  deleteShipping,
  findShippingById,
  listShippings,
  SHIPPING_TYPES,
  updateShipping,
} from './src/repositories/shippings.repository';
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
  isShopStaff,
  listShops,
  listShopsNear,
  setShopActive,
  updateShop,
} from './src/repositories/shops.repository';
export type {
  CreateStoreNoticeInput,
  ListStoreNoticesInput,
  StoreNoticeSortField,
  UpdateStoreNoticeInput,
} from './src/repositories/store-notices.repository';
export {
  createStoreNotice,
  deleteStoreNotice,
  findStoreNoticeById,
  listStoreNotices,
  markStoreNoticeRead,
  STORE_NOTICE_PRIORITIES,
  STORE_NOTICE_SORTABLE,
  STORE_NOTICE_TYPES,
  updateStoreNotice,
} from './src/repositories/store-notices.repository';
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
  CreateTaxInput,
  ListTaxesInput,
  UpdateTaxInput,
} from './src/repositories/taxes.repository';
export {
  createTax,
  deleteTax,
  findTaxById,
  listTaxes,
  updateTax,
} from './src/repositories/taxes.repository';
export type {
  CreateTermsAndConditionsInput,
  ListTermsAndConditionsInput,
  UpdateTermsAndConditionsInput,
} from './src/repositories/terms-and-conditions.repository';
export {
  createTermsAndConditions,
  deleteTermsAndConditions,
  findTermsAndConditionsBySlug,
  listTermsAndConditions,
  setTermsApproval,
  updateTermsAndConditions,
} from './src/repositories/terms-and-conditions.repository';
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
export type { ListWishlistProductsInput } from './src/repositories/wishlists.repository';
export {
  addToWishlist,
  findWishlistProduct,
  isInWishlist,
  listWishlistProducts,
  removeFromWishlist,
  toggleWishlist,
} from './src/repositories/wishlists.repository';
export type {
  CreateWithdrawInput,
  ListWithdrawsInput,
  WithdrawDetailRecord,
} from './src/repositories/withdraws.repository';
export {
  createWithdraw,
  deleteWithdraw,
  findWithdrawById,
  listWithdraws,
  updateWithdrawStatus,
  WITHDRAW_STATUSES,
} from './src/repositories/withdraws.repository';
export type { ExistingSlugLookup, SlugSource } from './src/slug';
export { generateSlug, normalizeSlug } from './src/slug';
