import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { CustomerOrder } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

@Injectable()
export class OrdersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(dto: CreateOrderDto) {
    return this.dataSource.transaction(async (manager) => {
      // Vérifier que le client existe
      const client = await manager.findOneBy(Client, { id: dto.clientId });
      if (!client) throw new NotFoundException('Client introuvable');

      // Détecter les produits dupliqués dans la commande
      const ids = dto.items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException('Produit duplique dans la commande');

      // Décrémenter le stock atomiquement, produit par produit.
      // Tri par id pour limiter les risques de deadlock entre transactions concurrentes.
      const byId = new Map(dto.items.map((i) => [i.productId, i]));
      const snapshots = new Map<number, Product>();

      for (const id of [...ids].sort((a, b) => a - b)) {
        const input = byId.get(id)!;
        const product = await manager.findOneBy(Product, { id });
        if (!product) throw new NotFoundException(`Produit ${id} introuvable`);

        const update = await manager
          .createQueryBuilder()
          .update(Product)
          .set({ stock: () => `stock - ${input.quantity}` })
          .where('id = :id AND stock >= :qty', { id, qty: input.quantity })
          .execute();

        if (update.affected !== 1)
          throw new BadRequestException(`Stock insuffisant pour le produit ${id}`);

        snapshots.set(id, product);
      }

      // Calcul du total en centimes pour éviter les erreurs de virgule flottante
      const cents = dto.items.reduce((sum, line) => {
        const p = snapshots.get(line.productId)!;
        return sum + Math.round(Number(p.price) * 100) * line.quantity;
      }, 0);

      // Créer la commande
      const order = await manager.save(
        CustomerOrder,
        manager.create(CustomerOrder, {
          clientId: client.id,
          total: (cents / 100).toFixed(2),
          status: 'CREATED',
        }),
      );

      // Créer les lignes de commande
      for (const line of dto.items) {
        const product = snapshots.get(line.productId)!;
        await manager.save(
          OrderItem,
          manager.create(OrderItem, {
            orderId: order.id,
            productId: product.id,
            quantity: line.quantity,
            unitPrice: product.price,
          }),
        );
      }

      // Retourner la commande complète avec ses relations
      return manager.findOneOrFail(CustomerOrder, {
        where: { id: order.id },
        relations: { client: true, items: { product: true } },
      });
    });
  }

  findAll() {
    return this.dataSource.getRepository(CustomerOrder).find({
      relations: { client: true, items: { product: true } },
    });
  }
}
