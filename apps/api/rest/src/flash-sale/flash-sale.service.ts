import { Injectable } from '@nestjs/common';
import flashSaleJSON from '#db/flash-sale.json' with { type: 'json' };
import ProductsByFlashSaleJSON from '#db/products-by-flash-sale.json' with { type: 'json' };
import { plainToClass } from 'class-transformer';
import Fuse from '../common/fuse.js';
import { paginate } from '#src/common/pagination/paginate.js';
import { FlashSale } from './entities/flash-sale.entity.js';
import { GetFlashSaleDto } from './dto/get-flash-sales.dto.js';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto.js';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto.js';
import { Product } from '#src/products/entities/product.entity.js';

const flashSale = plainToClass(FlashSale, flashSaleJSON);
const options = {
  keys: ['title'],
  threshold: 0.3,
};
const fuse = new Fuse(flashSale, options);

const productsByFlashSale = plainToClass(Product, ProductsByFlashSaleJSON);
const productsByFlashSaleOptions = {
  keys: ['name'],
  threshold: 0.3,
};
const productsByFlashSaleFuse = new Fuse(
  productsByFlashSale,
  productsByFlashSaleOptions,
);

@Injectable()
export class FlashSaleService {
  private flashSale: FlashSale[] = flashSale;
  private productsByFlashSale: Product[] = productsByFlashSale;

  create(_createFlashSaleDto: CreateFlashSaleDto) {
    return this.flashSale[0];
  }

  findAllFlashSale({ search, limit, page }: GetFlashSaleDto) {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    let data: FlashSale[] = this.flashSale;

    if (search) {
      const parseSearchParams = search.split(';');
      for (const searchParam of parseSearchParams) {
        const [, value] = searchParam.split(':');
        data = fuse.search(value)?.map(({ item }) => item);
      }
    }

    const results = data.slice(startIndex, endIndex);
    const url = `/flash-sale?search=${search}&limit=${limit}`;
    return {
      data: results,
      ...paginate(data.length, page, limit, results.length, url),
    };
  }

  getFlashSale(param: string, _language: string) {
    return this.flashSale.find((p) => p.slug === param);
  }

  update(_id: number, _updateFlashSaleDto: UpdateFlashSaleDto) {
    return this.flashSale[0];
  }

  remove(id: number) {
    return `This action removes a #${id} Flash Sale`;
  }

  findAllProductsByFlashSale({ search, limit, page }: GetFlashSaleDto) {
    if (!page) page = 1;
    if (!limit) limit = 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    let productsByData: Product[] = this.productsByFlashSale;

    if (search) {
      const parseSearchParams = search.split(';');
      for (const searchParam of parseSearchParams) {
        const [, value] = searchParam.split(':');
        productsByData = productsByFlashSaleFuse
          .search(value)
          ?.map(({ item }) => item);
      }
    }

    const results = productsByData.slice(startIndex, endIndex);
    const url = `/products-by-flash-sale?search=${search}&limit=${limit}`;
    return {
      data: results,
      ...paginate(productsByData.length, page, limit, results.length, url),
    };
  }
}
