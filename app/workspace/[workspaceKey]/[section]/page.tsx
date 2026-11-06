import {notFound} from 'next/navigation';import {requireWorkspace} from '@/lib/access';import {WorkspaceShell} from '@/components/workspace-shell';import {SectionPanels} from '@/components/section-panels';
const titles:Record<string,string>={inventory:'Inventory',orders:'Orders',reports:'Reports',expenses:'Expenses',team:'Team management',notifications:'Notifications',activity:'Activity log'};
export default async function WorkspaceSection({params}:{params:Promise<{workspaceKey:string;section:string}>}){
 const {workspaceKey,section}=await params;const title=titles[section];if(!title)notFound();const {supabase,profile}=await requireWorkspace(workspaceKey);
 const queries:Record<string,Promise<any>>={
  inventory:Promise.all([supabase.from('products').select('*').order('name'),supabase.from('categories').select('*').order('name')]),
  orders:Promise.all([supabase.from('orders').select('*,customers(full_name,phone),order_items(*,products(name,sku))').order('created_at',{ascending:false}).limit(100),supabase.from('products').select('id,name,sku,stock_quantity,reserved_quantity,selling_price,active').eq('active',true).order('name'),supabase.from('profiles').select('user_id,display_name').eq('role','order_booker').eq('active',true),supabase.from('payment_history').select('*,orders(order_number)').order('created_at',{ascending:false}).limit(100)]),
  reports:Promise.all([supabase.from('orders').select('id,order_number,total_amount,cost_total,amount_received,payment_status,status,created_at').eq('status','delivered').order('created_at',{ascending:false}).limit(1000),supabase.from('expenses').select('id,title,amount,expense_date').order('expense_date',{ascending:false}).limit(1000),supabase.from('products').select('id,name,stock_quantity,reserved_quantity,cost_price,selling_price').eq('active',true)]),
  expenses:supabase.from('expenses').select('*').order('expense_date',{ascending:false}).limit(200),
  team:supabase.from('profiles').select('user_id,display_name,email,role,active,created_at').order('created_at',{ascending:true}),
  notifications:supabase.from('notifications').select('*').order('created_at',{ascending:false}).limit(100),
  activity:supabase.from('activity_logs').select('*').order('created_at',{ascending:false}).limit(200),
 };
 if(!queries[section])notFound();const result=await queries[section];const business=await supabase.from('businesses').select('name').eq('id',profile.business_id).maybeSingle();
 return <WorkspaceShell workspaceKey={workspaceKey} role={profile.role} name={profile.display_name} businessName={business.data?.name||'Business workspace'}><div className="mb-6"><p className="muted text-sm">Workspace / {title}</p><h1 className="mt-1 text-2xl font-bold">{title}</h1></div><SectionPanels section={section} data={result} role={profile.role} userId={profile.user_id} workspaceKey={workspaceKey}/></WorkspaceShell>;
}