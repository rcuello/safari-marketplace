import { MessagesModule } from './messages/messages.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { StripeModule } from 'nestjs-stripe';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './auth/guards/permissions.guard.js';
import { AddressesModule } from './addresses/addresses.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AttributesModule } from './attributes/attributes.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorsModule } from './authors/authors.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { CommonModule } from './common/common.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { FeedbackModule } from './feedbacks/feedbacks.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { ManufacturersModule } from './manufacturers/manufacturers.module.js';
import { NewslettersModule } from './newsletters/newsletters.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentIntentModule } from './payment-intent/payment-intent.module.js';
import { PaymentMethodModule } from './payment-method/payment-method.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { ProductsModule } from './products/products.module.js';
import { QuestionModule } from './questions/questions.module.js';
import { RefundsModule } from './refunds/refunds.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReviewModule } from './reviews/reviews.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ShippingsModule } from './shippings/shippings.module.js';
import { ShopsModule } from './shops/shops.module.js';
import { TagsModule } from './tags/tags.module.js';
import { TaxesModule } from './taxes/taxes.module.js';
import { TypesModule } from './types/types.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';
import { WebHookModule } from './web-hook/web-hook.module.js';
import { WishlistsModule } from './wishlists/wishlists.module.js';
import { WithdrawsModule } from './withdraws/withdraws.module.js';
import { StoreNoticesModule } from './store-notices/store-notices.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { AiModule } from './ai/ai.module.js';
import { FaqsModule } from './faqs/faqs.module.js';
import { TermsAndConditionsModule } from './terms-and-conditions/terms-and-conditions.module.js';
import { FlashSaleModule } from './flash-sale/flash-sale.module.js';
import { RefundPoliciesModule } from './refund-policies/refund-policies.module.js';
import { RefundReasonModule } from './refund-reasons/refund-reasons.module.js';
import { NotifyLogsModule } from './notify-logs/notify-logs.module.js';
import { BecomeSellerModule } from './become-seller/become-seller.module.js';
import { OwnershipTransferModule } from './ownership-transfer/ownership-transfer.module.js';
@Module({
  imports: [
    ConfigModule.forRoot(),
    StripeModule.forRoot({
      apiKey: process.env.STRIPE_API_KEY,
      apiVersion: '2022-11-15',
    }),
    UsersModule,
    CommonModule,
    ProductsModule,
    OrdersModule,
    CategoriesModule,
    AnalyticsModule,
    AttributesModule,
    ShippingsModule,
    TaxesModule,
    TagsModule,
    ShopsModule,
    TypesModule,
    WithdrawsModule,
    UploadsModule,
    SettingsModule,
    CouponsModule,
    AddressesModule,
    ImportsModule,
    AuthModule,
    RefundsModule,
    AuthorsModule,
    ManufacturersModule,
    NewslettersModule,
    ReviewModule,
    QuestionModule,
    WishlistsModule,
    ReportsModule,
    FeedbackModule,
    PaymentMethodModule,
    PaymentIntentModule,
    WebHookModule,
    PaymentModule,
    StoreNoticesModule,
    ConversationsModule,
    MessagesModule,
    AiModule,
    FaqsModule,
    NotifyLogsModule,
    TermsAndConditionsModule,
    FlashSaleModule,
    RefundPoliciesModule,
    RefundReasonModule,
    BecomeSellerModule,
    OwnershipTransferModule,
  ],
  controllers: [],
  providers: [
    // El ORDEN importa: Nest ejecuta los guards globales secuencialmente y
    // corta en el primero que devuelve false (guards-consumer.js). JwtAuthGuard
    // debe poblar `request.user` ANTES de que PermissionsGuard lo lea.
    // Invertirlos produce 403 (o 401) para todas las rutas (design.md,
    // Decisión A).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
