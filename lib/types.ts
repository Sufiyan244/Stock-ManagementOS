export type AppRole = 'admin' | 'manager' | 'order_booker' | 'cashier';
export type Profile = { user_id: string; business_id: string; display_name: string; email: string; role: AppRole; active: boolean };
export type OrderStatus = 'pending' | 'confirmed' | 'allocated' | 'on_the_way' | 'delivered' | 'cancelled';
export type PaymentStatus = 'paid' | 'unpaid' | 'partial';