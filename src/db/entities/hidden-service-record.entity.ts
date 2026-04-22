import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm'

// NOTE: Schema is owned by the uns-record-indexer service. This entity is a
// read-only mirror kept in sync by hand. Do not enable `synchronize` against
// this table.
@Entity('hidden_service_records')
@Unique(['tokenId'])
export class HiddenServiceRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 128 })
  tokenId!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  value!: string | null

  @Column({ type: 'varchar', length: 253, nullable: true })
  name!: string | null

  @Column({ type: 'varchar', length: 66, nullable: true })
  lastTransactionHash!: string | null

  @Column({ type: 'int', default: 0 })
  lastBlockNumber!: number

  @Column({ type: 'int', default: 0 })
  lastLogIndex!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
