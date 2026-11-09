import { Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { LowStockService } from "./low-stock.service";
import { StockService } from "./stock.service";

@Module({ controllers: [StockController], providers: [StockService, LowStockService], exports: [StockService, LowStockService] })
export class StockModule {}
