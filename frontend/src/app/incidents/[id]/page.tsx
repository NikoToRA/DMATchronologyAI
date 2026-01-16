import { redirect } from 'next/navigation';

export default function IncidentRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/?incident=${params.id}`);
}

