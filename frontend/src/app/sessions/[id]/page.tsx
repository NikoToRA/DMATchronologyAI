import { redirect } from 'next/navigation';

export default function SessionRootPage({ params }: { params: { id: string } }) {
  redirect(`/sessions/${params.id}/chronology`);
}
