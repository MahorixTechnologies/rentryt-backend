import { Module } from '@nestjs/common';

import { OptionalViewerModule } from '../../common/auth/optional-viewer.module';
import { ListingsModule } from '../listings/listings.module';

import { SearchController } from './search.controller';

@Module({
  imports: [ListingsModule, OptionalViewerModule],
  controllers: [SearchController],
})
export class SearchModule {}
