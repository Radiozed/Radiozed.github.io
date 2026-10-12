import { defineCollection, z } from 'astro:content';

/**
 * 平台：代码跑在什么上面
 * 类别：这个模块是干什么用的
 * 难度：入门 / 进阶 / 硬核
 */
export const PLATFORMS = ['STM32', 'ESP32', 'Linux', '树莓派', 'Arduino', '通用'];
export const CATEGORIES = ['传感器', '通信', '显示', '存储', '电源', '执行器', '工具', '随笔'];

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    tags: z.array(z.string()).optional(),
    image: z.string().optional(),
    /** 代码运行平台，不填会从 tags 里推断 */
    platform: z.enum(PLATFORMS).optional(),
    /** 模块用途分类，不填会从 tags 里推断 */
    category: z.enum(CATEGORIES).optional(),
    /** 上手难度 */
    difficulty: z.enum(['入门', '进阶', '硬核']).optional(),
  }),
});

export const collections = { posts };
