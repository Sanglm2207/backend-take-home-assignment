import type { Database } from '@/server/db'

import { TRPCError } from '@trpc/server'
import { sql } from 'kysely'
import { z } from 'zod'

import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import {
  CountSchema,
  IdSchema,
  NonEmptyStringSchema,
} from '@/utils/server/base-schemas'
import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.connection().execute(async (conn) =>
        conn
          .selectFrom('users as friends')
          .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
          .innerJoin(
            userTotalFriendCount(conn).as('userTotalFriendCount'),
            'userTotalFriendCount.userId',
            'friends.id'
          )
          .innerJoin(
            conn
              .selectFrom('friendships as mutualFriendships')
              .innerJoin(
                'friendships as userFriendships',
                'mutualFriendships.friendUserId',
                'userFriendships.friendUserId'
              )
              .where('mutualFriendships.userId', '=', input.friendUserId)
              .where('userFriendships.userId', '=', ctx.session.userId)
              .where(
                'mutualFriendships.status',
                '=',
                FriendshipStatusSchema.Values['accepted']
              )
              .where(
                'userFriendships.status',
                '=',
                FriendshipStatusSchema.Values['accepted']
              )
              .select(
                sql`COUNT(${sql.ref('mutualFriendships.friendUserId')})`.as(
                  'mutualFriendCount'
                )
              )
              .as('mutualFriendCountQuery'),
            'mutualFriendCountQuery.mutualFriendCount',
            'mutualFriendCountQuery.mutualFriendCount'
          )
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .where(
            'friendships.status',
            '=',
            FriendshipStatusSchema.Values['accepted']
          )
          .select([
            'friends.id',
            'friends.fullName',
            'friends.phoneNumber',
            'userTotalFriendCount.totalFriendCount',
            'mutualFriendCountQuery.mutualFriendCount as mutualFriendCount',
          ])
          .executeTakeFirstOrThrow(() => new TRPCError({ code: 'NOT_FOUND' }))
          .then(
            z.object({
              id: IdSchema,
              fullName: NonEmptyStringSchema,
              phoneNumber: NonEmptyStringSchema,
              totalFriendCount: CountSchema,
              mutualFriendCount: CountSchema,
            }).parse
          )
      )
    }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}
