import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { NewStakerService } from '../services/btc-delegations/NewStakerService';
import { logger } from '../utils/logger';

// .env dosyasını yükle
dotenv.config();

// MongoDB bağlantısı
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MongoDB URI is not defined in environment variables');
        }

        // MongoDB bağlantı seçenekleri - performans için optimize edildi
        await mongoose.connect(mongoURI, {
            maxPoolSize: 50, // Bağlantı havuzu boyutunu artır
            socketTimeoutMS: 60000, // Soket zaman aşımını artır
        });
        
        logger.info('MongoDB connected successfully');
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

// Ana fonksiyon
const populateNewStakers = async () => {
    try {
        // MongoDB'ye bağlan
        await connectDB();

        logger.info('Starting to populate new stakers from existing delegations...');

        // NewStakerService'i başlat
        const stakerService = NewStakerService.getInstance();

        // Önce delegasyonlardan staker'ları oluştur
       await stakerService.createStakersFromDelegations();

        // Bellek kullanımını logla
        logMemoryUsage();

        // Tüm staker istatistiklerini yeniden hesapla
        await stakerService.recalculateAllStakerStats();

        // Son bellek kullanımını logla
        logMemoryUsage();

        logger.info('Successfully populated new stakers from existing delegations');
        process.exit(0);
    } catch (error) {
        logger.error('Error populating new stakers:', error);
        process.exit(1);
    }
};

// Scripti çalıştır
populateNewStakers();

// Bellek kullanımını izle
process.on('warning', e => {
    if (e.name === 'ResourceExhaustedError') {
        logger.warn('Memory warning received:', e.message);
        // Bellek uyarısı alındığında garbage collector'ı zorla
        if (global.gc) {
            logger.info('Forcing garbage collection');
            global.gc();
        }
    }
});

// Bellek kullanımını düzenli olarak logla
const logMemoryUsage = () => {
    const memoryUsage = process.memoryUsage();
    logger.info(`Memory usage: RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB, Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
};

setInterval(logMemoryUsage, 30000); // Her 30 saniyede bir bellek kullanımını logla 