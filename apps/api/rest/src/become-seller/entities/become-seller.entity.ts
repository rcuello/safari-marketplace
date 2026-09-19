import { ApiProperty } from '@nestjs/swagger';
import { CoreEntity } from 'src/common/entities/core.entity';

/**
 * Forma de adjunto local a este módulo: las 6 imágenes del payload real
 * traen exactamente estas 4 claves (`become-seller.json`), no las de
 * `Attachment` (`id`/`created_at`/`updated_at` obligatorios + `thumbnail?`/
 * `original?`). Reutilizar `Attachment` inventaría dos campos obligatorios
 * que el dato no tiene y ocultaría `file_name` (D-6, `design.md`).
 */
export class BecomeSellerImage {
  thumbnail: string;
  original: string;
  id: number;
  file_name: string;
}

export class BecomeSellerBanner {
  newsTickerTitle: string;
  newsTickerURL: string;
  title: string;
  description: string;
  button1Name: string;
  button1Link: string;
  button2Name: string;
  button2Link: string;
  image: BecomeSellerImage;
}

export class BecomeSellerShowcase {
  title: string;
  description: string;
  buttonName: string;
  buttonLink: string;
  button2Name: string;
  button2Link: string;
  image: BecomeSellerImage;
}

export class SellingStepItem {
  title: string;
  description: string;
  image: BecomeSellerImage;
}

export class BusinessPurposeItem {
  description: string;
  title: string;
  icon: {
    value: string;
  };
}

export class BecomeSellerGuidelineItem {
  title: string;
  // Único `@ApiProperty` del change (D-7): sin `strictNullChecks` en
  // `tsconfig.json`, el plugin de Swagger reduce `string | null` a `string`
  // antes de leerlo, así que `nullable: true` no puede inferirse — y el
  // dato sí trae `link === null` (`guidelineItems[4]`).
  @ApiProperty({ type: String, nullable: true })
  link: string | null;
}

export class FaqItems {
  title: string;
  description: string;
}

export class BecomeSellerUserStory {
  title: string;
  description: string;
  link: string;
  thumbnail: BecomeSellerImage;
}

export class BecomeSellerContact {
  title: string;
  description: string;
}

/**
 * `id`/`created_at`/`updated_at` aquí son texto plano dentro del `jsonb` de
 * `commissions` (cada tier del array), no columnas de Prisma: a diferencia
 * de `BecomeSellerEnvelope` (que sí extiende `CoreEntity`, con columnas
 * tipadas `Date`), esta clase NO extiende `CoreEntity` — hacerlo inventaría
 * un `id: number`/`created_at: Date` que el dato de `commissions[]` no es.
 */
export class CommissionItem {
  id: number;
  level: string;
  sub_level: string;
  description: string;
  min_balance: number;
  max_balance: string;
  commission: number;
  image: BecomeSellerImage;
  language: string;
  created_at: string;
  updated_at: string;
}

export class BecomeSellerOptions {
  defaultCommissionRate: number;
  defaultCommissionDetails: string;
  banner: BecomeSellerBanner;
  sellingStepsTitle: string;
  sellingStepsDescription: string;
  sellingStepsItem: SellingStepItem[];
  userStoryTitle: string;
  userStoryDescription: string;
  purposeTitle: string;
  purposeDescription: string;
  purposeItems: BusinessPurposeItem[];
  commissionTitle: string;
  commissionDescription: string;
  isMultiCommissionRate: boolean;
  dashboard: BecomeSellerShowcase;
  guidelineTitle: string;
  guidelineDescription: string;
  guidelineItems: BecomeSellerGuidelineItem[];
  faqTitle: string;
  faqDescription: string;
  faqItems: FaqItems[];
  contact: BecomeSellerContact;
  sellerOpportunity: BecomeSellerShowcase;
  userStories: BecomeSellerUserStory[];
}

/** El envoltorio real de `page_options` en la respuesta: sí es `CoreEntity`
 * (`id`/`created_at`/`updated_at` son columnas Prisma), más `language` y el
 * objeto interno de 24 claves. */
export class BecomeSellerEnvelope extends CoreEntity {
  page_options: BecomeSellerOptions;
  language: string;
}

export class BecomeSeller {
  page_options: BecomeSellerEnvelope;
  commissions: CommissionItem[];
}
