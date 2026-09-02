import { Controller, Get, Headers, Query } from '@nestjs/common';

import { OptionalViewerService } from '../../common/auth/optional-viewer.service';
import { ListingsService } from '../listings/listings.service';

/**
 * One global search endpoint shared by web, mobile, and admin — public (no
 * auth required), ranked by relevance rather than listPublic()'s simpler
 * `contains`-match filter. See ListingsService.globalSearch() for the
 * ranking logic.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly listings: ListingsService,
    private readonly optionalViewer: OptionalViewerService,
  ) {}

  @Get()
  async search(
    @Headers('authorization') authHeader: string | undefined,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const viewer = await this.optionalViewer.decode(authHeader);
    const parsedLimit = limit != null ? Number(limit) : undefined;
    return await this.listings.globalSearch({
      q: q ?? '',
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      viewerEmail: viewer?.email ?? null,
    });
  }
}
